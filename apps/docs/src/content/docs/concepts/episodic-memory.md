---
title: "Episodic memory"
description: "An episode is a summarised chunk of a thread: what the conversation was about, and what it revealed."
---
An **episode** is a summarised chunk of a thread: what the conversation was
about, and what it revealed.

Episodes serve two purposes:

1. **Provenance**, every fact points back to the episode it came from.
2. **Cross-thread recall**, "what did we talk about last time", retrieved by
   relevance rather than by scanning transcripts.

---

## Shape

```json
{
  "episodeId": "8b21…",
  "threadId": "f2cb…",
  "dataset": "user_42",
  "status": "completed",
  "summary": "The user is choosing a compact family car under $30k. They rejected SUVs as too big and are interested in the Toyota Corolla Hybrid for city commuting.",
  "keyLearnings": [
    "user wants a family car under $30k",
    "user finds suvs too big",
    "user does city commutes"
  ],
  "messageCount": 6,
  "startedAt": "2026-08-16T09:02:11.000Z",
  "endedAt":   "2026-08-16T09:14:02.000Z",
  "retryCount": 0,
  "error": null,
  "createdAt": "…", "updatedAt": "…"
}
```

The `summary` is embedded (768 dimensions) so episodes can be searched
semantically.

---

## When an episode is created

"Done" is not knowable at write time: no message tells you the next one is not
coming. So Memory Soda never guesses. Every trigger is either explicit or
hindsight, and an episode is **consolidation, not freshness**, so firing late
costs nothing while firing on every pause costs one LLM call each. All four
triggers open the same kind of row over the same window: the messages since the
thread's last episode.

### 1. Explicit

```ts
await memory.endThread(threadId);   // → { threadId, episodeQueued: true }
```

Queues extraction immediately. The thread stays writable, this is a checkpoint,
not a close. Use it whenever your agent knows a task or conversation ended.

### 2. A new thread in the same dataset

Starting a new thread for `user_42` is the strongest signal that their old one
is over, the same rule chat products use. Any sibling thread still waiting on
its idle timer has that timer pulled forward to at most **5 minutes** out (the
grace covers agents that fan out across several threads at once). Threads with
nothing uncaptured are not touched.

### 3. Inactivity

Every `addMessage` upserts a row into `scheduled_episodes` with
`fireAt = now + autoEpisodeIntervalMs` (**default 30 minutes**, the standard
session timeout). Because it is an upsert, a burst of messages keeps pushing the
deadline out, so one real session gap yields one episode.

```
msg  msg  msg              (30 min idle)
 │    │    │                    │
 └────┴────┴── fireAt keeps ────┴──► episode created
              being pushed
```

### 4. Sleep-time backstop

Once an hour the worker looks for threads quiet for **24 hours** that still have
messages no episode covers and no timer waiting on them. That only happens after
a crash between claiming a timer and writing the episode, but it means nothing
is ever lost.

---

## Sequence windows

Each episode records the message range it covers:

```
episode 1   startSequence 1   endSequence 12
episode 2   startSequence 13  endSequence 27
```

`startSequence` is one past the previous episode's end. Semantic extraction reads
**only this window**, so successive episodes on one thread never re-extract each
other's messages, which would otherwise re-judge the same contradictions
repeatedly.

Episode *summarisation* still reads the whole un-compacted thread, which is why
the latest episode reads as a rolling summary of the conversation so far.

---

## Archival

Creating an episode **archives every prior episode on that thread**. Only one
episode per thread is `completed` at a time; the rest become `archived`.

Consequence: a thread has one current summary, not a timeline of them. Archived
episodes remain in the table (facts still reference them for provenance) but are
excluded from retrieval.

---

## Status lifecycle

Two independent status columns advance separately.

```
status:          pending ─► processing ─► completed
                    │                          │
                    └──────► failed ◄──────────┘   (retried, bounded by maxRetries)
                                             └──► archived   (superseded)

semanticStatus:  pending ─► processing ─► completed
                    │                          │
                    └──────► failed            └──► skipped   (nothing to extract,
                                                               or semantic disabled)
```

| `status` | Meaning |
|---|---|
| `pending` | Row created, summarisation not started |
| `processing` | A worker has claimed it |
| `completed` | Summary and embedding written |
| `failed` | Summarisation or embedding failed; `error` holds why |
| `archived` | Superseded by a newer episode on the same thread, or soft-deleted |
| `deleted` | Reserved; not currently produced |

`semanticStatus` drives the [extraction pipeline](/concepts/extraction-pipeline/) and
advances after `status` reaches `completed`.

Both are claimed atomically (`UPDATE … WHERE status IN (…) RETURNING`), so
concurrent workers cannot double-process. A `processing` claim older than
10 minutes is treated as orphaned and reclaimed.

---

## Retrieval

Episodes are **opt-in** on recall:

```ts
const { episodes } = await memory.recall({
  dataset: 'user_42',
  query: 'car recommendations',
  include: ['episodes'],
});
```

```json
{
  "episodes": {
    "episodes": [
      { "episodeId": "8b21…", "summary": "…", "keyLearnings": ["…"],
        "startedAt": "…", "endedAt": "…", "relevanceScore": 0.82 }
    ],
    "episodeCount": 12
  }
}
```

`episodeCount` is the total for the dataset; the array holds the top
`contextEpisodes` (default 3).

### Ranking

```
relevance = cosineSimilarity × similarityWeight  +  1/(1 + daysSince) × recencyWeight
                                    (0.7)                                   (0.3)
```

Recency matters more for episodes than for facts, a conversation from yesterday
is usually more relevant than a similar one from a year ago. Without a query,
episodes fall back to plain recency order.

### Formatting

Unlike facts, episodes come back as **structured data, not a rendered string**.
You format them yourself:

```ts
const block = episodes?.episodes
  ?.map((e, i) => `Past conversation ${i + 1} (${e.endedAt.slice(0, 10)}):\n${e.summary}`)
  .join('\n\n') ?? '';
```

---

## Direct access

```ts
// via the API
GET  /v1/memory/episodic/datasets/:dataset/episodes?status=completed&limit=10
GET  /v1/memory/episodic/datasets/:dataset/episodes/search?q=cars&limit=5
GET  /v1/memory/episodic/episodes/:episodeId
DELETE /v1/memory/episodic/episodes/:episodeId      // soft delete → archived
POST /v1/memory/episodic/episodes/:episodeId/retry  // only when status is 'failed'
```

These are not exposed on the SDK, use `recall({ include: ['episodes'] })` for
normal reads, or call the endpoints directly for admin work. Full details:
[Episodic memory API](/api/episodic-memory/).

---

## Overlap with semantic memory

`keyLearnings` and `facts` are extracted by different prompts from the same
conversation and describe substantially the same knowledge in two formats.

In practice: **prefer facts.** They are structured, deduplicated,
contradiction-resolved and bi-temporal. `keyLearnings` are a flat string array
with none of that. Episodes earn their place through `summary` (narrative
context that triples cannot express) and provenance, not through `keyLearnings`.

---

## Next

- [Semantic memory](/concepts/semantic-memory/), the durable fact store
- [The extraction pipeline](/concepts/extraction-pipeline/), how an episode becomes facts

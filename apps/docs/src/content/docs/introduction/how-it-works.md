---
title: "How it works"
description: "Two paths, deliberately separate: the write path is asynchronous and expensive; the read path is synchronous and cheap."
---
Two paths, deliberately separate: the **write path** is asynchronous and
expensive; the **read path** is synchronous and cheap.

---

## The write path

You append messages. Everything else happens in the background.

```
POST /v1/memory/working/threads/:id/messages
        │
        │ synchronous, returns in a few milliseconds
        ▼
   messages row written, thread.lastActivityAt bumped,
   an episode scheduled for `now + autoEpisodeIntervalMs`
        │
        ⋮ 10s of inactivity (default), then a 5s scheduler tick
        ▼
┌─────────────────────────────────────────────┐
│ 1. Episode summarisation            1 LLM   │  "what was this conversation about"
│    → episodes.summary, keyLearnings         │
│    → embedding of the summary               │
└──────────────────┬──────────────────────────┘
                   ▼
┌─────────────────────────────────────────────┐
│ 2. Graph extraction                 1 LLM   │  reads the RAW messages, not the summary
│    → entities[], relationships[],           │
│      literalFacts[]                         │
└──────────────────┬──────────────────────────┘
                   ▼
┌─────────────────────────────────────────────┐
│ 3. Entity resolution           embeddings   │  "pcoket 3" → "dji osmo pocket 3"
│    exact name → reuse                       │
│    else nearest same-type entity ≥ 0.88     │
│    else insert                              │
└──────────────────┬──────────────────────────┘
                   ▼
┌─────────────────────────────────────────────┐
│ 4. Deduplication               embeddings   │  drop exact + near-duplicate claims
│    exact (subject,predicate,object)         │
│    then cosine ≥ 0.95 against live facts     │
└──────────────────┬──────────────────────────┘
                   ▼
┌─────────────────────────────────────────────┐
│ 5. Contradiction resolution         1 LLM   │  "works at google" vs "works at anthropic"
│    verdict per pair: old | new | neither    │
└──────────────────┬──────────────────────────┘
                   ▼
┌─────────────────────────────────────────────┐
│ 6. Write                    one transaction │  advisory lock per (dataset, project)
│    invalidate losers, insert survivors      │
└─────────────────────────────────────────────┘
```

**Three LLM calls and two embedding batches per episode.** This is why it is
asynchronous, and why a fact is typically retrievable 20–60 seconds after the
message that produced it.

See [The extraction pipeline](/concepts/extraction-pipeline/) for each step
in detail.

### What survives extraction

The extraction prompt is aggressive about discarding noise. From a
camera-shopping conversation it emits roughly four facts, not forty:

| Kept | Dropped |
|---|---|
| `user is interested in dji osmo pocket 3` | `user is asking about cameras` (task chatter) |
| `user finds too bulky mirrorless cameras` | `dji osmo pocket 3 has a 1-inch sensor` (the assistant said it) |
| `user shoots travel vlogging` | `user wants cinematic` (fragment of a fuller fact) |
| `user wants a travel camera that is small, cinematic-looking, under $1000` | a `pcoket 3` entity (typo, folded into the canonical one) |

---

## The read path

Two independent calls, because they cost different amounts.

### `prepare()`, conversation state

Pure SQL. No embeddings, no model calls. Returns the active compact summary plus
the last N messages, oldest first, ready to spread into a chat-completion
request.

```ts
const { messages } = await memory.prepare(threadId, { messageLimit: 20 });
// [{ role: 'system', content: 'Summary of earlier turns…' },
//  { role: 'user', content: '…' }, { role: 'assistant', content: '…' }]
```

### `recall()`, long-term memory

Thread-free: it needs only a `dataset`, so you can personalise a search page or
an agent tool call, not just a chat turn.

```ts
const { context, factCount } = await memory.recall({
  dataset: 'user_42',
  query: userMessage,
});
```

Internally:

```
query ──► embed once
            │
            ├─► vector similarity over facts.embedding
            ├─► entity anchor: entities named in the query, plus the query's
            │   nearest entities; then every live fact touching them
            └─► keyword: postgres full-text over subject+predicate+object
                        │
                        ▼
             Reciprocal Rank Fusion (k=60)
                        │
                        ▼
         group by anchor entity → render to text
```

The entity-anchor signal is the reliability net. It is what lets
`"planning a trip to Thailand"` surface `"favourite food is mango sticky rice"`
when neither vector nor keyword search would bridge that gap.

See [Retrieval](/concepts/retrieval/).

---

## Putting a turn together

```ts
// 1. Read, both calls are independent, so run them together
const [{ messages }, { context }] = await Promise.all([
  memory.prepare(threadId, { messageLimit: 20 }),
  memory.recall({ dataset, query: userMessage }),
]);

// 2. Your model call
const reply = await yourLLM({
  system: `You are a helpful assistant.\n\n${context}`,
  messages: [...messages, { role: 'user', content: userMessage }],
});

// 3. Write, fire and forget; extraction happens in the background
await memory.addMessage(threadId, { role: 'user', content: userMessage });
await memory.addMessage(threadId, { role: 'assistant', content: reply });
```

`prepareAndRecall()` collapses step 1 into one call. See
[Your first integration](/getting-started/your-first-integration/) for the
complete version.

---

## Where the time goes

Rough numbers from a local instance.

| Operation | Typical | Notes |
|---|---|---|
| `addMessage` | 5–15 ms | occasionally ~30 s when it triggers auto-compaction |
| `prepare` | 10–30 ms | three parallel `SELECT`s |
| `recall` | 200–500 ms | dominated by the one embedding round trip |
| `recall` with `synthesis` | 1.5–3.5 s | adds an LLM call to the read path |
| message → fact retrievable | 20–60 s | asynchronous, see the write path above |

---

## Next

- [Architecture](/introduction/architecture/), processes, tables, background jobs
- [Working memory](/concepts/working-memory/), threads, messages, compaction

---
title: "Playground"
description: "An interactive console that drives the real /v1 API and shows every request and response as it happens."
---
An interactive console that drives the real `/v1` API and shows every request and
response as it happens.

It is a network inspector purpose-built for the memory pipeline. If you want to
understand why something was or was not extracted, start here.

---

## Setup

The playground authenticates with an **API key**, not your dashboard session,
because it exercises the same surface your application does.

1. Create a key on [API Keys](/dashboard/api-keys/).
2. Paste it into the key field at the top.
3. Accept the generated `dataset` (`ds_a1b2c3d4`) or type your own.

Using a throwaway dataset keeps experiments out of real users' memory.

---

## Layout

```
┌────────────────────────────┬──────────────────────────────┐
│                            │  Ops │ Episodes │ Recall │ Facts │
│      chat transcript       ├──────────────────────────────┤
│                            │                              │
│                            │   selected tab               │
│                            │                              │
├────────────────────────────┤                              │
│  message input             │                              │
└────────────────────────────┴──────────────────────────────┘
  working / episodic / semantic settings panels
```

---

## The ops log

The centrepiece. Every API call the playground makes is recorded with:

- **operation type** — `thread_created`, `message_added`, `prepare`, `recall`,
  `auto_compacted`, `episode_scheduled`, `facts_extracted`, `error`, …
- **relative timestamp** — `+0.0s`, `+1.4s`, `+12.8s` from the start of the thread
- **duration**
- the full **request body**, **response body** and **HTTP status**

A typical turn:

```
+0.0s   thread_created      POST /v1/threads                          201   18ms
+0.4s   message_added       POST …/threads/f2cb…/messages             201   11ms
+0.4s   prepare             POST …/threads/f2cb…/prepare              200   24ms
+0.5s   recall              POST /v1/memory/recall                    200  318ms
+2.9s   ai_replied          POST …/threads/f2cb…/chat                 201 2410ms
+13.1s  episode_scheduled   (background)
+31.7s  facts_extracted     GET  …/semantic/…/facts?episodeId=8b21…   200   14ms
```

That last line is the one to watch: it appears when the pipeline finishes and
tells you exactly which facts came out of that episode.

> The log is **in-memory and ephemeral**. Reloading the page clears it, and there
> is no export.

---

## Watching extraction

`useExtractionPoller` polls for new episodes every 2.5 seconds (giving up after
90) and, when one completes, fetches the facts it produced and emits a
`facts_extracted` op.

So the normal loop is:

1. Send a few messages.
2. Stop typing.
3. Wait out `autoEpisodeIntervalMs` (default 10s) plus the scheduler tick.
4. Watch `facts_extracted` land, ~20–60 seconds later.

The polling GETs are deliberately **not** logged as ops — they would drown the
signal.

To skip the wait, use the **End thread** action, which calls
[`POST /v1/threads/:id/end`](/api/threads/#post-v1threadsthreadidend) and
queues extraction immediately.

---

## Tabs

### Ops
The log described above. Click any entry to expand the full request and response.

### Recall
Run [`recall()`](/api/recall/) by hand against the current dataset, with all
the controls exposed:

| Control | Maps to |
|---|---|
| Query | `query` |
| Min confidence | `minConfidence` |
| Limit | `limit` |
| Include episodes / synthesis / raw | `include` |
| As of | `asOf` |

The rendered `context` block is shown exactly as your application would receive
it. This is the fastest way to see what your prompt is actually going to contain.

### Facts
Live facts for the dataset, refreshed as extraction lands. Individual facts can
be deleted, which emits a `fact_deleted` op.

### Episodes
Episodes for the dataset, with summaries, key learnings and status. Failed ones
can be retried.

---

## Settings panels

Working, episodic and semantic settings for the session.

| Panel | Notes |
|---|---|
| **Working memory** | `autoCompactThreshold`, `messageLimit` — applied to threads created here |
| **Episodic** | `autoEpisodeIntervalMs`, `contextEpisodes`, weights |
| **Semantic** | `factsInContext`, thresholds |

> These are **playground-local**. They do not change project settings, and they
> reset on reload. To change real defaults use
> [Project Settings](/dashboard/project-settings/).

Lowering `autoEpisodeIntervalMs` to a second or two makes experimenting much
faster — thread-level overrides accept values down to `1000`.

---

## The chat panel

Messages are sent through
[`POST …/chat`](/api/working-memory/#post-v1memoryworkingthreadsthreadidchat),
which runs the whole turn server-side against Gemini.

> **This endpoint exists for the playground.** Your application should use
> `prepare` + `recall` with your own model. The SDK deliberately does not expose
> `chat`.

Each message shows its sequence number, timestamp, and any token/model/latency
metadata. There is a manual message form for injecting `system` and `tool` roles
and arbitrary metadata — useful for testing how extraction handles non-user
turns.

Replies are **not streamed**; they appear when the call completes.

---

## What it is good for

| Question | How |
|---|---|
| Why wasn't that extracted? | Send it, wait for `facts_extracted`, inspect the response |
| What will my prompt contain? | Recall tab — read the rendered `context` |
| Is the pipeline working at all? | Ops log shows every call and its status |
| How long does extraction really take? | Relative timestamps between `message_added` and `facts_extracted` |
| Does raising `factsInContext` help? | Change it in the semantic panel, re-run recall, compare |
| What does a contradiction do? | State something, then contradict it, watch the old fact become superseded |

---

## Limitations

| | |
|---|---|
| Ops log is ephemeral | No persistence, no export, no sharing |
| Needs an API key pasted in | Cannot use your dashboard session |
| Settings are local | Do not affect the project |
| No streaming | Replies arrive all at once |
| Facts/Episodes tabs duplicate [Datasets](/dashboard/datasets/) | Same data, narrower view |
| Gemini only | The `chat` endpoint hard-codes it |

---

## Next

- [Datasets](/dashboard/datasets/) — the durable view of the same data
- [The extraction pipeline](/concepts/extraction-pipeline/) — what you are watching
- [Tuning retrieval quality](/guides/tuning-retrieval/)

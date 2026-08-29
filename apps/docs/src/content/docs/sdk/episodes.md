---
title: "Episodes"
description: "Inspect what the system made of a conversation."
---
An episode is one summarised stretch of conversation, and the unit the
extraction pipeline works in. You rarely need this client to build something,
[`recall()`](/sdk/client/) already folds episodes into context on request. You
need them to see what happened.

---

## `listEpisodes()`

```ts
list(dataset: string, opts?: {
  limit?: number;                       // 1–100, default 10
  before?: string;                      // ISO cursor on endedAt
  status?: EpisodeStatus | 'all';       // default 'completed'
}): Promise<EpisodesListResponse>
```

```ts
const { episodes } = await memory.listEpisodes('u_42', { limit: 5 });
episodes[0].summary;      // "The user compared family cars…"
episodes[0].keyLearnings; // ["user wants a compact car under $30k", …]
```

Only the newest episode per thread has status `completed`; earlier ones are
`archived` when a new episode opens over later messages. Pass
`status: 'all'` to see the whole history, or `status: 'failed'` to find
extractions that need attention.

---

## `searchEpisodes()`

```ts
search(dataset: string, q: string, opts?: { limit?: number }): Promise<EpisodeWithRelevance[]>
```

Semantic search over episode summaries, ranked by a blend of similarity and
recency (the split is the project's `similarityWeight`).

```ts
const hits = await memory.searchEpisodes('u_42', 'car shopping');
hits[0].relevanceScore; // 0.83
```

---

## `getEpisode()`

```ts
get(episodeId: string): Promise<Episode>
```

One episode, including `status`, `error`, `retryCount`, and the message range it
covers. This is what to poll after `threads.end()` if you want to know when
extraction has finished.

---

## Operator actions

Retrying a failed extraction and archiving an episode are **not** on the SDK.
Both are things an operator does to a background job, not things an application
does on a turn, so they stay on the HTTP API and in the dashboard:

```http
POST   /v1/memory/episodic/episodes/:episodeId/retry
DELETE /v1/memory/episodic/episodes/:episodeId
```

Archiving leaves the facts an episode produced in place. An episode is
provenance, not the memory itself, removing the record of a conversation does
not un-learn what the conversation taught. To retire a fact use
[`deleteFact()`](/sdk/semantic-memory/), and to erase everything use
[`forgetDataset()`](/sdk/datasets/).

Failed episodes are retried automatically by the background sweep, up to the
project's `maxRetries`.

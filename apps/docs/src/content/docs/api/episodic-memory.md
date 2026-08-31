---
title: 'Episodic memory API'
description: 'Base path: /v1/memory/episodic · Auth: API key'
---

Base path: `/v1/memory/episodic` · Auth: [API key](/api/authentication/)

An admin surface for inspecting and repairing episodes. **Not exposed on the
SDK**, normal reads go through
[`recall({ include: ['episodes'] })`](/api/recall/#episodes).

Concepts: [Episodic memory](/concepts/episodic-memory/)

## `GET /v1/memory/episodic/datasets/:dataset/episodes`

### Query

| Param    | Type         | Default     | Notes                                                             |
| -------- | ------------ | ----------- | ----------------------------------------------------------------- |
| `limit`  | integer      | `10`        | 1–100                                                             |
| `before` | ISO datetime | ,           | Cursor on `endedAt`                                               |
| `status` | enum         | `completed` | `pending`, `processing`, `completed`, `failed`, `archived`, `all` |

`all` skips the status filter entirely.

### Response `200`

```json
{
  "episodes": [
    {
      "episodeId": "8b21…",
      "threadId": "f2cb…",
      "dataset": "user_42",
      "projectId": "ea43…",
      "status": "completed",
      "summary": "The user is choosing a compact family car under $30k…",
      "keyLearnings": [
        "user wants a family car under $30k",
        "user finds suvs too big"
      ],
      "messageCount": 6,
      "tokenCount": null,
      "startedAt": "2026-08-16T09:02:11.000Z",
      "endedAt": "2026-08-16T09:14:02.000Z",
      "processingStartedAt": "2026-08-16T09:14:12.000Z",
      "processingCompletedAt": "2026-08-16T09:14:19.000Z",
      "error": null,
      "retryCount": 0,
      "metadata": null,
      "createdAt": "…",
      "updatedAt": "…"
    }
  ],
  "total": 12,
  "hasMore": true
}
```

Ordered by `endedAt` descending.

> `tokenCount` here is an **episode** column (an integer, usually `null`) and is
> unrelated to a message's `tokens` object.

```bash
# Everything that failed
curl "http://localhost:3004/v1/memory/episodic/datasets/user_42/episodes?status=failed" \
  -H "Authorization: Bearer $KEY"
```

## `GET /v1/memory/episodic/datasets/:dataset/episodes/search`

Semantic search over episode summaries.

### Query

| Param   | Type    | Required | Notes             |
| ------- | ------- | -------- | ----------------- |
| `q`     | string  | **yes**  | 1–1000 chars      |
| `limit` | integer | no       | Default 5, max 20 |

### Response `200`

```json
{
  "episodes": [
    { "episodeId": "8b21…", "summary": "…", "relevanceScore": 0.82, "…": "…" }
  ]
}
```

Full episode objects plus `relevanceScore`, ranked by

```
cosineSimilarity × 0.7  +  1/(1 + daysSince) × 0.3
```

Only `completed` episodes are searched. Embeds `q`, so it costs one embedding
call.

```bash
curl "http://localhost:3004/v1/memory/episodic/datasets/user_42/episodes/search?q=cars&limit=5" \
  -H "Authorization: Bearer $KEY"
```

## `GET /v1/memory/episodic/episodes/:episodeId`

Note the path: **not** under `/datasets/:dataset`.

### Response `200`

```json
{ "episode": { "episodeId": "8b21…", "…": "…" } }
```

Wrapped in an `episode` key, unlike the list endpoints.

| Code  | Body                               |
| ----- | ---------------------------------- |
| `404` | `{ "error": "Episode not found" }` |

## `DELETE /v1/memory/episodic/episodes/:episodeId`

Soft delete, sets `status: archived`.

### Response `200`

```json
{ "episodeId": "8b21…", "deleted": true }
```

| Code  | Body                                         | Cause            |
| ----- | -------------------------------------------- | ---------------- |
| `400` | `{ "error": "Episode is already archived" }` | Already archived |
| `404` | `{ "error": "Episode not found" }`           |                  |

> **Facts extracted from the episode are not deleted.** They keep their
> `episodeId` reference. To remove the knowledge, delete the facts,
> see [Curating memory](/guides/curating-memory/).
>
> The summary, key learnings and embedding are also retained; only the status
> changes, which removes it from retrieval.

## `POST /v1/memory/episodic/episodes/:episodeId/retry`

Re-queue a failed episode.

### Response `200`

```json
{ "episodeId": "8b21…", "status": "pending" }
```

| Code  | Body                                                    | Cause                                |
| ----- | ------------------------------------------------------- | ------------------------------------ |
| `400` | `{ "error": "Only failed episodes can be retried" }`    | Status is not `failed`               |
| `400` | `{ "error": "Episode has used its full retry budget" }` | `retryCount` already at `maxRetries` |
| `404` | `{ "error": "Episode not found" }`                      |                                      |

Resets to `pending`, increments `retryCount`, and starts processing
asynchronously. The background retry job does the same thing automatically
every 120 seconds, so this endpoint is only for retrying **immediately**
instead of waiting for the next sweep. It is bound by the same `maxRetries`
(default 3) as the background job, it cannot push an episode past its cap.

```bash
curl -X POST "http://localhost:3004/v1/memory/episodic/episodes/8b21…/retry" \
  -H "Authorization: Bearer $KEY"
```

## Status reference

| `status`     | Meaning                                        |
| ------------ | ---------------------------------------------- |
| `pending`    | Created, summarisation not started             |
| `processing` | Claimed by a worker                            |
| `completed`  | Summary and embedding written                  |
| `failed`     | Summarisation or embedding failed; see `error` |
| `archived`   | Superseded by a newer episode, or soft-deleted |
| `deleted`    | Reserved; not currently produced               |

A second column, `semanticStatus`, drives the
[extraction pipeline](/concepts/extraction-pipeline/), `pending`,
`processing`, `completed`, `failed`, `skipped`.

> **`semanticStatus` is not exposed on any endpoint.** An episode can show
> `status: completed` while its fact extraction has failed. To check, query
> Postgres directly:
>
> ```sql
> SELECT id, status, semantic_status, semantic_retry_count, error
> FROM episodes
> WHERE dataset = 'user_42'
> ORDER BY created_at DESC;
> ```

## Debugging a missing fact

1. Did an episode get created?
   `GET …/episodes?status=completed`
2. Did it cover the right messages? Check `startedAt`/`endedAt` and
   `messageCount`.
3. Does its summary mention the thing you expected?
4. Did semantic extraction run? Check `semantic_status` in SQL.
5. What facts did it produce?
   `GET /v1/memory/semantic/datasets/:dataset/facts?episodeId=…`

The [Playground](/dashboard/playground/) does most of this live.

## Next

- [Episodic memory](/concepts/episodic-memory/), the concepts
- [The extraction pipeline](/concepts/extraction-pipeline/)
- [Background jobs](/operations/background-jobs/)

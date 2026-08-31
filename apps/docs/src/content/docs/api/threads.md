---
title: 'Threads API'
description: 'Base path: /v1/threads · Auth: API key'
---

Base path: `/v1/threads` · Auth: [API key](/api/authentication/)

SDK equivalent: [`memory.threads`](/sdk/threads/)

---

## `POST /v1/threads`

Create a conversation thread.

### Request

```json
{
  "dataset": "user_42",
  "tags": ["support", "billing"],
  "metadata": { "channel": "web", "ticketId": "T-1094" },
  "autoCompactThreshold": 30,
  "settings": {
    "episodic": { "autoEpisodeIntervalMs": 60000 }
  }
}
```

| Field                  | Type     | Required | Notes                                          |
| ---------------------- | -------- | -------- | ---------------------------------------------- |
| `dataset`              | string   | no       | Min 1 char. **Randomly generated if omitted.** |
| `tags`                 | string[] | no       |                                                |
| `metadata`             | object   | no       | Arbitrary JSON                                 |
| `autoCompactThreshold` | integer  | no       | `>= 2`. Omit to disable compaction.            |
| `settings.episodic`    | object   | no       | Partial override of project episodic settings  |

`settings.episodic` accepts: `enabled`, `autoEpisodeIntervalMs` (`>= 1000` or
`null`), `maxMessages` (1–1000), `maxRetries` (0–10), `contextEpisodes` (1–20),
`similarityWeight` (0–1), `recencyWeight` (0–1).

> There is no way to override **semantic** settings per thread through this
> endpoint, only episodic.

### Response `201`

```json
{
  "threadId": "f2cbb67c-5ab7-4ad3-8c6b-03f080b752a3",
  "projectId": "ea43688c-1027-4bbc-b406-44d6b120ff5c",
  "dataset": "user_42",
  "createdAt": "2026-08-16T09:02:11.615Z",
  "settings": {
    "autoCompactThreshold": 30,
    "episodic": {
      "enabled": true,
      "autoEpisodeIntervalMs": 60000,
      "maxMessages": 100,
      "maxRetries": 3,
      "contextEpisodes": 3,
      "similarityWeight": 0.7,
      "recencyWeight": 0.3
    }
  }
}
```

### Example

```bash
curl -X POST http://localhost:3004/v1/threads \
  -H "Authorization: Bearer $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"dataset":"user_42"}'
```

---

## `GET /v1/threads/:threadId`

### Response `200`

```json
{
  "threadId": "f2cb…",
  "dataset": "user_42",
  "tags": ["support"],
  "metadata": { "channel": "web" },
  "createdAt": "2026-08-16T09:02:11.615Z",
  "lastActivityAt": "2026-08-16T09:14:02.814Z",
  "settings": { "autoCompactThreshold": 30, "episodic": { "…": "…" } },
  "lastCompactedAt": null,
  "lastCompactedSequence": 0
}
```

> No `messageCount`, use [`GET …/stats`](/api/working-memory/#get-v1memoryworkingthreadsthreadidstats).

### Errors

| Code  | Body                                                                      |
| ----- | ------------------------------------------------------------------------- |
| `404` | `{ "error": "Thread not found" }`, missing, or belongs to another project |

---

## `PATCH /v1/threads/:threadId`

Merge-update metadata. Existing keys are preserved.

### Request

```json
{ "metadata": { "resolved": true } }
```

`metadata` is required. Nothing else is patchable, `tags`,
`autoCompactThreshold` and `settings` are fixed at creation.

### Response `200`

The full thread, as `GET`.

```bash
# before: { "channel": "web", "ticketId": "T-1094" }
curl -X PATCH http://localhost:3004/v1/threads/$THREAD \
  -H "Authorization: Bearer $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"metadata":{"resolved":true}}'
# after:  { "channel": "web", "ticketId": "T-1094", "resolved": true }
```

Implemented as a JSONB merge (`||`), so it is **one level deep**, a nested
object is replaced wholesale. Removing a key requires reading, deleting locally
and writing the whole object back.

---

## `POST /v1/threads/:threadId/end`

Queue [episode extraction](/concepts/episodic-memory/) immediately.

> **The thread is not closed.** It stays writable and you can keep appending.
> Read this as _checkpoint_, not _close_.

### Response `200`

```json
{ "threadId": "f2cb…", "episodeQueued": true }
```

`episodeQueued` is `false` when episodic memory is disabled for the thread or
project.

### Behaviour

1. A `pending` episode row is created **synchronously**, so the trigger survives
   a crash.
2. It archives every prior episode on the thread.
3. It stamps the message range it covers.
4. Summarisation and extraction run asynchronously, three LLM calls.

Calling it repeatedly is harmless but costs three LLM calls each time.

```bash
curl -X POST http://localhost:3004/v1/threads/$THREAD/end \
  -H "Authorization: Bearer $KEY"
```

---

## Not available

| Operation                            | Status                                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------- |
| Delete a thread                      | No endpoint. Deleting the row in SQL cascades to messages.                              |
| List threads                         | Dashboard only, [`GET /dashboard/projects/:projectId/browse/threads`](/api/dashboard/). |
| Reassign a thread to another dataset | Not supported.                                                                          |

---

## Next

- [Working memory API](/api/working-memory/), appending and reading messages
- [`memory.threads`](/sdk/threads/)

---
title: 'Working memory API'
description: 'Base path: /v1/memory/working · Auth: API key'
---

Base path: `/v1/memory/working` · Auth: [API key](/api/authentication/)

SDK equivalent: [`memory.working`](/sdk/working-memory/)

## `POST /v1/memory/working/threads/:threadId/messages`

Append a message. `sequenceNumber` is assigned by the server.

### Request

```json
{
  "role": "assistant",
  "content": "The Toyota Corolla Hybrid is a great fit.",
  "tokens": { "input": 512, "output": 128, "total": 640 },
  "model": "gpt-4o",
  "latencyMs": 840,
  "metadata": { "stopReason": "stop", "agentName": "support-bot" }
}
```

| Field       | Type                                        | Required | Notes                                             |
| ----------- | ------------------------------------------- | -------- | ------------------------------------------------- |
| `role`      | `user` \| `assistant` \| `system` \| `tool` | yes      |                                                   |
| `content`   | string                                      | yes      | Non-empty                                         |
| `tokens`    | object                                      | no       | `input`, `output`, `total`, non-negative integers |
| `model`     | string                                      | no       |                                                   |
| `latencyMs` | integer                                     | no       | Non-negative                                      |
| `metadata`  | object                                      | no       | Only `stopReason` and `agentName` are accepted    |

### Response `201`

```json
{
  "messageId": "1abc…",
  "threadId": "f2cb…",
  "sequenceNumber": 7,
  "role": "assistant",
  "createdAt": "2026-08-16T09:14:02.114Z",
  "compacted": false
}
```

### Latency warning

Usually 5–15 ms. **When this insert crosses `autoCompactThreshold`, compaction
runs inline and the response can take up to 30 seconds** (it makes an LLM call).
`compacted: true` indicates it happened.

### Field rename

The token field is `tokens`. It was previously `tokenCount`. Because unknown
fields are stripped rather than rejected, sending `tokenCount` returns `201` with
the token data **silently discarded**.

### Errors

| Code  | Body                                               |
| ----- | -------------------------------------------------- |
| `400` | `{ "error": "Validation error", "issues": [...] }` |
| `404` | `{ "error": "Thread not found" }`                  |

## `GET /v1/memory/working/threads/:threadId/messages`

Raw message rows, including compacted ones.

### Query

| Param    | Default | Notes                                            |
| -------- | ------- | ------------------------------------------------ |
| `limit`  | `20`    | 1–100                                            |
| `before` | ,       | Cursor: `sequenceNumber` strictly less than this |
| `order`  | `asc`   | or `desc`                                        |

### Response `200`

```json
{
  "messages": [
    {
      "messageId": "1abc…",
      "threadId": "f2cb…",
      "role": "user",
      "content": "I'm looking for a family car.",
      "sequenceNumber": 1,
      "tokens": { "input": 11, "output": 22, "total": 33 },
      "model": null,
      "latencyMs": null,
      "metadata": null,
      "compactedAt": null,
      "createdAt": "2026-08-16T09:02:11.708Z"
    }
  ],
  "total": 42,
  "hasMore": true
}
```

`total` counts every message in the thread, ignoring the cursor.

```bash
curl "http://localhost:3004/v1/memory/working/threads/$THREAD/messages?limit=50&order=desc" \
  -H "Authorization: Bearer $KEY"
```

## `POST /v1/memory/working/threads/:threadId/prepare`

The LLM-ready conversation window. Pure SQL, no embeddings, no model calls.

### Request

```json
{ "messageLimit": 20 }
```

| Field          | Default | Range |
| -------------- | ------- | ----- |
| `messageLimit` | `20`    | 1–100 |

An empty body `{}` is valid.

### Response `200`

```json
{
  "threadId": "f2cb…",
  "dataset": "user_42",
  "messages": [
    { "role": "system", "content": "Earlier: the user is choosing a car…" },
    { "role": "user", "content": "what about resale value?" },
    { "role": "assistant", "content": "Hybrids hold their value well…" }
  ],
  "messageCount": 42,
  "truncated": true,
  "compacted": true,
  "warning": "messageLimit (10) is less than autoCompactThreshold (30). …"
}
```

| Field          | Meaning                                                     |
| -------------- | ----------------------------------------------------------- |
| `messages`     | Oldest first. Ready for a chat-completion request.          |
| `dataset`      | Handy for a follow-up `recall`.                             |
| `messageCount` | Un-compacted, non-summary messages in the thread.           |
| `truncated`    | `messageCount > messageLimit`.                              |
| `compacted`    | A compact summary is present, first in the array.           |
| `warning`      | Only when `messageLimit < autoCompactThreshold`. Act on it. |

The active compact summary is always first and **never counts against
`messageLimit`**.

```bash
curl -X POST http://localhost:3004/v1/memory/working/threads/$THREAD/prepare \
  -H "Authorization: Bearer $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"messageLimit":30}'
```

## `POST /dashboard/projects/:projectId/chat/threads/:threadId/chat`

Runs a complete turn **server-side**: appends the user message, prepares, recalls,
calls Gemini, appends the reply.

> **Dashboard only.** This route lives behind a login session, not an API key,
> and is absent from the SDK. It exists for the
> [Playground](/dashboard/playground/); it hard-codes Gemini and a system-prompt
> format, so shipping it on the `/v1` surface would advertise a demo as part of
> the product. For real integrations use `prepare` + `recall` with your own
> model, or the [AI SDK middleware](/sdk/ai-sdk/).

### Request

```json
{
  "content": "what about resale value?",
  "systemPrompt": "You are a car shopping assistant.",
  "messageLimit": 20,
  "verbose": false
}
```

| Field          | Required | Notes                                           |
| -------------- | -------- | ----------------------------------------------- |
| `content`      | yes      | The user message                                |
| `systemPrompt` | no       | Appended after the memory blocks                |
| `messageLimit` | no       | Default 20, 1–100                               |
| `verbose`      | no       | Include the full recall payload in the response |

### Response `201`

```json
{
  "userMessage": {
    "messageId": "…",
    "sequenceNumber": 7,
    "role": "user",
    "createdAt": "…"
  },
  "assistantMessage": {
    "messageId": "…",
    "sequenceNumber": 8,
    "role": "assistant",
    "content": "Hybrids hold their value…",
    "createdAt": "…"
  },
  "compacted": false,
  "prepare": { "messageCount": 8, "truncated": false, "compacted": false },
  "recallSummary": {
    "episodeCount": 2,
    "factCount": 4,
    "hasContext": true,
    "hasSynthesis": true
  },
  "recall": { "…": "only when verbose: true" }
}
```

Recall runs with `include: ['episodes','synthesis','raw']`, so this endpoint
makes **two or three LLM calls** per turn.

Recall failure is non-fatal, the user message is already persisted, so the turn
proceeds without long-term memory rather than returning 500.

## `POST /v1/memory/working/threads/:threadId/compact`

Summarise un-compacted messages into a single rolling summary.

### Response `200`

```json
{
  "threadId": "f2cb…",
  "summaryMessageId": "9c1d…",
  "compactedCount": 28,
  "fromSequence": 1,
  "toSequence": 28
}
```

Or, when there is nothing to do:

```json
{ "ok": true, "compacted": false, "message": "Nothing to compact" }
```

**Two different response shapes on `200`.** Narrow on `summaryMessageId` before
using the result.

Makes an LLM call; takes seconds. See
[Handling long conversations](/guides/long-conversations/).

## `GET /v1/memory/working/threads/:threadId/stats`

### Response `200`

```json
{
  "threadId": "f2cb…",
  "messageCount": 42,
  "tokenUsage": {
    "totalInput": 8120,
    "totalOutput": 3310,
    "totalTokens": 11430,
    "averagePerMessage": 272
  },
  "sessionDuration": { "ms": 918000, "seconds": 918 },
  "createdAt": "2026-08-16T09:02:11.615Z",
  "lastActivityAt": "2026-08-16T09:14:02.814Z"
}
```

- `tokenUsage` is `null` unless you supplied `tokens` on messages, nothing is
  counted for you.
- `sessionDuration` is `null` for threads with fewer than two real messages.
- `messageCount` counts un-compacted messages including the summary row.

## Next

- [Recall API](/api/recall/), long-term memory
- [Working memory](/concepts/working-memory/), the concepts

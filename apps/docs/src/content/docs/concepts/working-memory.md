---
title: "Working memory"
description: "The live conversation window: threads, messages, and automatic compaction."
---
The live conversation window: threads, messages, and automatic compaction.

Working memory is **pure state**. Reading it costs three SQL queries, no
embeddings, no model calls. It is what you send to the model as chat history.

---

## Threads

A thread is one conversation.

```ts
const thread = await memory.createThread({
  dataset: 'user_42',
  tags: ['support', 'billing'],
  metadata: { channel: 'web', ticketId: 'T-1094' },
  autoCompactThreshold: 30,
});
```

| Field | Type | Notes |
|---|---|---|
| `threadId` | `string` | UUID. Persist it with your own conversation record. |
| `dataset` | `string` | Whose memory this feeds. Generated if omitted. |
| `tags` | `string[]` | Free labels. |
| `metadata` | `object` | Arbitrary JSON. Merge-updated by `threads.update()`. |
| `autoCompactThreshold` | `number \| null` | `null` disables compaction. |
| `createdAt`, `lastActivityAt` | ISO string | `lastActivityAt` bumps on every message. |
| `lastCompactedAt`, `lastCompactedSequence` |, | Compaction watermarks. |

**Threads never end.** `threads.end()` is a misleading name: it triggers
extraction and the thread stays writable. There is no closed or archived state.

---

## Messages

```ts
await memory.addMessage(threadId, {
  role: 'user',            // 'user' | 'assistant' | 'system' | 'tool'
  content: 'I drive a Honda Civic.',
  tokens: { input: 12, output: 0, total: 12 },  // optional telemetry
  model: 'gpt-4o',                              // optional
  latencyMs: 640,                               // optional
  metadata: { stopReason: 'stop', agentName: 'support-bot' },
});
```

Returns:

```json
{
  "messageId": "0d0f…",
  "threadId": "f2cb…",
  "sequenceNumber": 7,
  "role": "user",
  "createdAt": "2026-08-16T09:14:02.114Z",
  "compacted": false
}
```

### `sequenceNumber`

A per-thread monotonic integer assigned by the server inside a row-locked
transaction. It is:

- the **pagination cursor** (`before`)
- the **compaction watermark** (`lastCompactedSequence`)
- independent of timestamps, so concurrent writes can't interleave ambiguously

You never supply it.

### `compacted: true`

Means this insert crossed `autoCompactThreshold` and triggered a compaction run.
That run happens **inline**, so this particular call may take up to 30 seconds
(it makes an LLM call). Most calls return in single-digit milliseconds.

---

## `prepare()`, the read

```ts
const result = await memory.prepare(threadId, { messageLimit: 20 });
```

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
  "compacted": true
}
```

| Field | Meaning |
|---|---|
| `messages` | Ready to spread into a chat-completion request. Oldest first. |
| `messageCount` | Total **un-compacted, non-summary** messages in the thread. |
| `truncated` | `messageCount > messageLimit`, older messages were left out. |
| `compacted` | An active compact summary is present and is the first element. |
| `warning` | Present when `messageLimit < autoCompactThreshold`. Read it. |

The active compact summary is **always included first and never counts against
`messageLimit`**, so shrinking the limit can never drop compacted context.

`messageLimit` defaults to 20, maximum 100.

---

## Compaction

Once a thread grows past `autoCompactThreshold` un-compacted messages, older
messages are folded into a single `role: 'system'` summary.

```
before                        after compaction
─────────────────────────     ─────────────────────────
msg 1  user                   msg 1  ─┐
msg 2  assistant              msg 2   │ compactedAt set,
…                             …       │ excluded from prepare()
msg 29 user                   msg 29 ─┘
msg 30 assistant              msg 30  user      ← keepLast: 1, kept verbatim
                              msg 31  system    ← the summary
```

Key properties:

- **Rolling.** Each run folds the previous summary into the new one, so there is
  always exactly one active summary.
- **Non-destructive.** Original rows are kept and stamped with `compactedAt`.
  `listMessages()` still returns them; `prepare()` does not.
- **The triggering message is kept verbatim** (`keepLast: 1`) so the next turn
  sees the user's actual words rather than a paraphrase.
- Summaries are tagged `metadata.type = 'compact_summary'` with the range they
  cover.

### Manual compaction

```ts
const result = await memory.compact(threadId);
// { threadId, summaryMessageId, compactedCount, fromSequence, toSequence }
// or { ok: true, compacted: false, message: 'Nothing to compact' }
```

### The `messageLimit` trap

If `messageLimit < autoCompactThreshold`, messages between the summary and the
retrieved tail vanish from context:

```
threshold 30, messageLimit 10

[summary covering 1–29]  [30] [31] … [42]
                          └── only the last 10 returned ──┘
                                    messages 30–32 lost
```

`prepare()` returns a `warning` when it detects this. Set
`messageLimit >= autoCompactThreshold`. See
[Handling long conversations](/guides/long-conversations/).

---

## Listing raw messages

`prepare()` is for the model. `listMessages()` is for you, it returns full rows
including compacted ones.

```ts
const { messages, total, hasMore } = await memory.listMessages(threadId, {
  limit: 50,          // 1–100, default 20
  before: 120,        // cursor: sequenceNumber less than this
  order: 'asc',       // or 'desc'
});
```

---

## Thread stats

Counts and token totals for a thread live on the HTTP API rather than the SDK,
they are arithmetic over the `tokens` you supplied, so the client would only be
handing your own numbers back to you.

```http
GET /v1/memory/working/threads/:threadId/stats
```

```json
{
  "threadId": "f2cb…",
  "messageCount": 42,
  "tokenUsage": { "totalInput": 8120, "totalOutput": 3310,
                  "totalTokens": 11430, "averagePerMessage": 272 },
  "sessionDuration": { "ms": 918000, "seconds": 918 },
  "createdAt": "…",
  "lastActivityAt": "…"
}
```

`tokenUsage` is `null` unless you supplied `tokens` on messages, Memory Soda
does not count tokens for you.

---

## Relationship to the other layers

Working memory is the **source** the others derive from:

```
messages ──► episode summary (episodic) ──► facts + entities (semantic)
```

Compaction and extraction are independent. Compacting does not delete anything
extraction needs, episodes record the sequence range they cover, and
extraction reads raw message rows within that range.

---

## Next

- [Episodic memory](/concepts/episodic-memory/), what happens to a finished chunk of conversation
- [`memory.working`](/sdk/working-memory/), full method reference
- [Handling long conversations](/guides/long-conversations/)

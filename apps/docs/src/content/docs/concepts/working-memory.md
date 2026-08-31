---
title: 'Working memory'
description: 'The live conversation window: threads, messages, and automatic compaction.'
---

The live conversation window: threads, messages, and automatic compaction.

Working memory is **pure state**. Reading it costs three SQL queries, no
embeddings, no model calls. It is what you send to the model as chat history.

## Threads

A thread is one conversation: a `dataset`, optional `tags` and `metadata`, and
an `autoCompactThreshold` (`null` disables compaction). Field reference:
[`memory.threads`](/sdk/threads/).

**Threads never end.** `threads.end()` is a misleading name: it triggers
extraction and the thread stays writable. There is no closed or archived state.

## Messages

```ts
await memory.addMessage(threadId, {
  role: 'user', // 'user' | 'assistant' | 'system' | 'tool'
  content: 'I drive a Honda Civic.',
  tokens: { input: 12, output: 0, total: 12 }, // optional telemetry
});
// → { messageId, threadId, sequenceNumber: 7, role, createdAt, compacted: false }
```

### `sequenceNumber`

A per-thread monotonic integer assigned by the server inside a row-locked
transaction. It is the **pagination cursor** (`before`), the **compaction
watermark**, and independent of timestamps, so concurrent writes can't
interleave ambiguously. You never supply it.

### `compacted: true`

Means this insert crossed `autoCompactThreshold` and triggered a compaction run.
That run happens **inline**, so this particular call may take up to 30 seconds
(it makes an LLM call). Most calls return in single-digit milliseconds.

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

`messages` is ready to spread into a chat-completion request, oldest first. The
active compact summary is **always included first and never counts against
`messageLimit`**, so shrinking the limit can never drop compacted context.
`messageLimit` defaults to 20, maximum 100. A `warning` field appears when
`messageLimit < autoCompactThreshold`, read it.

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
- **When triggered automatically** (crossing `autoCompactThreshold` inside
  `addMessage`), the message that tripped it is kept verbatim (`keepLast: 1`)
  so the next turn sees the user's actual words rather than a paraphrase.

Manual compaction, `await memory.compact(threadId)`, folds **everything**
uncompacted into the summary (`keepLast: 0`), there is no message left
outside it.

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

## Listing raw messages

`prepare()` is for the model. `listMessages()` is for you, it returns full rows
including compacted ones, paginated by `sequenceNumber`. Thread stats (message
counts, token totals from the `tokens` you supplied) live on the HTTP API:
`GET /v1/memory/working/threads/:threadId/stats`.

## Relationship to the other layers

Working memory is the **source** the others derive from:

```
messages ──► episode summary (episodic) ──► facts + entities (semantic)
```

Compaction and extraction are independent. Compacting does not delete anything
extraction needs, episodes record the sequence range they cover, and
extraction reads raw message rows within that range.

## Next

- [Episodic memory](/concepts/episodic-memory/), what happens to a finished chunk of conversation
- [`memory.working`](/sdk/working-memory/), full method reference
- [Handling long conversations](/guides/long-conversations/)

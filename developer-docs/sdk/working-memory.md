# `client.workingMemory`

Messages, the LLM-ready window, compaction and stats.

```ts
await memory.workingMemory.addMessage(threadId, { role: 'user', content: 'Hello' });
const { messages } = await memory.workingMemory.prepare(threadId);
```

---

## `addMessage()`

```ts
addMessage(threadId: string, opts: WMAddMessageRequest): Promise<WMAddMessageResponse>
```

| Option | Type | Required | Notes |
|---|---|---|---|
| `role` | `'user' \| 'assistant' \| 'system' \| 'tool'` | yes | |
| `content` | `string` | yes | Non-empty. |
| `tokens` | `{ input?, output?, total? }` | no | Your telemetry. Not counted for you. |
| `model` | `string` | no | Model that produced an assistant turn. |
| `latencyMs` | `number` | no | |
| `metadata` | `{ stopReason?, agentName? }` | no | Only these two keys are accepted. |

```ts
const res = await memory.workingMemory.addMessage(threadId, {
  role: 'assistant',
  content: reply,
  model: 'gpt-4o',
  tokens: { input: 512, output: 128, total: 640 },
  latencyMs: 840,
  metadata: { stopReason: 'stop' },
});
```

```json
{
  "messageId": "0d0f…",
  "threadId": "f2cb…",
  "sequenceNumber": 7,
  "role": "assistant",
  "createdAt": "2026-08-16T09:14:02.114Z",
  "compacted": false
}
```

**`sequenceNumber` is assigned by the server** inside a row-locked transaction.
Append in order — the sequence reflects insert order, not the order you intended.

### Latency

Usually 5–15 ms. **But when this insert crosses `autoCompactThreshold`,
compaction runs inline and the call can take up to 30 seconds** (it makes an LLM
call). `compacted: true` tells you it happened.

If that spike matters, either leave compaction off and call
[`compact()`](#compact) yourself off the request path, or set the threshold high
enough that it fires rarely.

### Unknown fields are dropped, not rejected

Validation strips unknown keys rather than erroring. Sending the old
`tokenCount` field returns `201` with the token data silently discarded — the
field is now `tokens`.

---

## `prepare()`

The LLM-ready conversation window. Pure SQL — no embeddings, no model calls.

```ts
prepare(threadId: string, opts?: { messageLimit?: number }): Promise<WMPrepareResponse>
```

| Option | Default | Range |
|---|---|---|
| `messageLimit` | `20` | 1–100 |

```ts
const { messages, messageCount, truncated, compacted, warning } =
  await memory.workingMemory.prepare(threadId, { messageLimit: 30 });
```

```json
{
  "threadId": "f2cb…",
  "dataset": "user_42",
  "messages": [
    { "role": "system", "content": "Earlier: the user is choosing a camera…" },
    { "role": "user", "content": "what about low light?" },
    { "role": "assistant", "content": "The 1-inch sensor handles it well…" }
  ],
  "messageCount": 42,
  "truncated": true,
  "compacted": true
}
```

| Field | Meaning |
|---|---|
| `messages` | Oldest first. Spread straight into a chat-completion request. |
| `dataset` | Handy for a follow-up `recall()`. |
| `messageCount` | Total un-compacted, non-summary messages. |
| `truncated` | Older messages were left out. |
| `compacted` | A compact summary is present, as the first element. |
| `warning` | Present when `messageLimit < autoCompactThreshold`. **Act on it.** |

The active compact summary is always first and **never counts against
`messageLimit`**, so lowering the limit cannot drop compacted context.

```ts
if (warning) logger.warn({ threadId, warning }, 'context may be incomplete');
```

---

## `listMessages()`

Raw rows, including compacted ones. For your UI, not for the model.

```ts
listMessages(threadId: string, opts?: WMListMessagesQuery): Promise<WMListMessagesResponse>
```

| Option | Default | Notes |
|---|---|---|
| `limit` | `20` | 1–100 |
| `before` | — | Cursor: `sequenceNumber` strictly less than this |
| `order` | `'asc'` | or `'desc'` |

```ts
const { messages, total, hasMore } = await memory.workingMemory.listMessages(threadId, {
  limit: 50,
  order: 'desc',
});
```

Each `WMMessage` carries `messageId`, `threadId`, `role`, `content`,
`sequenceNumber`, `tokens`, `model`, `latencyMs`, `metadata`, `compactedAt`,
`createdAt`.

### Paginating

```ts
async function* allMessages(threadId: string) {
  let before: number | undefined;
  for (;;) {
    const page = await memory.workingMemory.listMessages(threadId, {
      limit: 100, order: 'desc', before,
    });
    yield* page.messages;
    if (!page.hasMore || page.messages.length === 0) return;
    before = page.messages[page.messages.length - 1].sequenceNumber;
  }
}
```

---

## `compact()`

```ts
compact(threadId: string): Promise<WMCompactResult>
```

```ts
const result = await memory.workingMemory.compact(threadId);
// { threadId, summaryMessageId, compactedCount, fromSequence, toSequence }
```

When there is nothing to compact the endpoint returns
`{ ok: true, compacted: false, message: 'Nothing to compact' }` — which does not
match `WMCompactResult`. Guard on the field you need:

```ts
const result = await memory.workingMemory.compact(threadId);
if ('summaryMessageId' in result) {
  logger.info({ compacted: result.compactedCount }, 'thread compacted');
}
```

Makes an LLM call; takes seconds. Auto-compaction covers most cases — reach for
this when you want compaction off the request path.

See [Handling long conversations](../guides/long-conversations.md).

---

## `getThreadStats()`

```ts
getThreadStats(threadId: string): Promise<WMThreadStatsResponse>
```

```json
{
  "threadId": "f2cb…",
  "messageCount": 42,
  "tokenUsage": {
    "totalInput": 8120, "totalOutput": 3310,
    "totalTokens": 11430, "averagePerMessage": 272
  },
  "sessionDuration": { "ms": 918000, "seconds": 918 },
  "createdAt": "…",
  "lastActivityAt": "…"
}
```

- `tokenUsage` is `null` unless you supplied `tokens` on messages.
- `sessionDuration` is `null` for threads with fewer than two real messages.
- `messageCount` counts un-compacted messages **including** the summary row.

---

## `startConversation()`

Create a thread, append the first message, and prepare — one call.

```ts
startConversation(opts: {
  dataset?: string;
  firstMessage: WMAddMessageRequest;
  tags?: string[];
  metadata?: Record<string, unknown>;
  autoCompactThreshold?: number;
  settings?: WMCreateThreadRequest['settings'];
}): Promise<{ threadId: string; prepare: WMPrepareResponse }>
```

```ts
const { threadId, prepare } = await memory.workingMemory.startConversation({
  dataset: 'user_42',
  firstMessage: { role: 'user', content: 'Hi, I need help with my order.' },
});
```

Three sequential HTTP requests under the hood, not a batch — the saving is
ergonomic, not network. Only useful for the opening turn.

---

## Turn recipe

```ts
// read
const [{ messages }, { context }] = await Promise.all([
  memory.workingMemory.prepare(threadId, { messageLimit: 20 }),
  memory.recall({ dataset: userId, query: userMessage }),
]);

// generate
const reply = await yourLLM({ system: context, messages: [...messages, { role: 'user', content: userMessage }] });

// write
await memory.workingMemory.addMessage(threadId, { role: 'user', content: userMessage });
await memory.workingMemory.addMessage(threadId, { role: 'assistant', content: reply });
```

---

## Next

- [`client.semantic`](./semantic-memory.md) — reading and curating facts
- [Handling long conversations](../guides/long-conversations.md) — compaction in practice

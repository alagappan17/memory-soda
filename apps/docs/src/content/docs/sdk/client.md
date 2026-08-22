---
title: "`MemorySodaClient`"
description: "The root client. Owns configuration and the two top-level reads."
---
The root client. Owns configuration and the two top-level reads.

```ts
import { MemorySodaClient } from '@alagappan17/memory-soda';

const memory = new MemorySodaClient({
  baseUrl: 'http://localhost:3004',
  apiKey: process.env.MEMORY_SODA_API_KEY!,
});
```

---

## Constructor

```ts
new MemorySodaClient(config: MemorySodaConfig)
```

| Option | Type | Default | Notes |
|---|---|---|---|
| `baseUrl` | `string` | — | Required. Trailing slash is stripped. |
| `apiKey` | `string` | — | Required. `ms_…`, sent as `Authorization: Bearer`. |
| `timeout` | `number` | `60000` | Per-request timeout in ms. |

### `MemorySodaClient.fromEnv()`

```ts
const memory = MemorySodaClient.fromEnv();
```

Reads `MEMORY_SODA_BASE_URL` and `MEMORY_SODA_API_KEY`. Throws a plain `Error`
if either is missing — this is a startup misconfiguration, not a runtime failure.

### Sub-clients

| Property | Type | Docs |
|---|---|---|
| `.threads` | `ThreadClient` | [threads](/sdk/threads/) |
| `.workingMemory` | `WorkingMemoryClient` | [working memory](/sdk/working-memory/) |
| `.semantic` | `SemanticMemoryClient` | [semantic memory](/sdk/semantic-memory/) |

---

## `recall()`

Long-term memory for a dataset. **No thread required** — usable from a chat
turn, a search page, or an agent tool call.

```ts
recall(req: RecallRequest): Promise<RecallResponse>
```

### Request

| Field | Type | Default | Notes |
|---|---|---|---|
| `dataset` | `string` | — | **Required.** 1–256 chars. |
| `query` | `string` | — | Drives ranking. Omit for most-recent facts. Max 2000 chars. |
| `include` | `('episodes' \| 'synthesis' \| 'raw')[]` | `[]` | Opt-in extras. |
| `limit` | `number` | `factsInContext` (8) | 1–100. |
| `minConfidence` | `number` | `retrievalMinConfidence` (0.5) | 0–1. |
| `asOf` | `string` | — | ISO datetime or date. Point-in-time. |

### Response

```ts
interface RecallResponse {
  context: string;                       // always — the prompt-ready block, "" if nothing
  factCount: number;                     // always
  synthesis: string | null;              // only with include: ['synthesis']
  facts: SemanticFact[] | null;          // only with include: ['raw']
  groups: RankedContextGroup[] | null;   // only with include: ['raw']
  episodes: EpisodeContext | null;       // only with include: ['episodes']
}
```

### Examples

```ts
// The common case
const { context } = await memory.recall({ dataset: 'user_42', query: userMessage });

// Session opener — no query, most recent facts
const { context } = await memory.recall({ dataset: 'user_42' });

// Everything, for a debug view
const full = await memory.recall({
  dataset: 'user_42',
  query: userMessage,
  include: ['episodes', 'synthesis', 'raw'],
  limit: 20,
});

// Point-in-time
const past = await memory.recall({
  dataset: 'user_42',
  asOf: '2026-06-01T00:00:00Z',
});
```

> `include: ['synthesis']` adds an LLM call and 1–3 seconds. Everything else is
> a database read.

Concepts: [Retrieval](/concepts/retrieval/) · API: [`POST /v1/memory/recall`](/api/recall/)

---

## `prepareAndRecall()`

Convenience for a chat turn: working memory and long-term memory together.

```ts
prepareAndRecall(
  threadId: string,
  opts?: Omit<RecallRequest, 'dataset'> & { dataset?: string; messageLimit?: number },
): Promise<{ prepared: WMPrepareResponse; recalled: RecallResponse }>
```

```ts
const { prepared, recalled } = await memory.prepareAndRecall(threadId, {
  dataset: userId,       // pass it if you know it
  query: userMessage,
  messageLimit: 20,
});
```

**Pass `dataset` if you have it.** With it, both requests run in parallel.
Without it, `recall` has to wait for `prepare` to return the thread's dataset —
correct, but serial.

```ts
// parallel        ~500ms
await memory.prepareAndRecall(threadId, { dataset: userId, query });

// serial          ~530ms  (prepare, then recall)
await memory.prepareAndRecall(threadId, { query });
```

Equivalent to:

```ts
const [prepared, recalled] = await Promise.all([
  memory.workingMemory.prepare(threadId, { messageLimit }),
  memory.recall({ dataset, query }),
]);
```

Use the explicit form when you want independent error handling — as written,
one failure rejects both.

---

## `health()`

```ts
health(): Promise<HealthResponse>
```

```json
{ "status": "ok", "services": { "postgres": "ok" } }
```

Returns HTTP `503` when a service is down, which the SDK surfaces as an
`ApiError`. It does **not** require a valid API key — the endpoint is public.

```ts
try {
  await memory.health();
} catch (err) {
  if (err instanceof ApiError && err.status === 503) {
    // degraded — the body still has per-service status
  }
}
```

---

## `ping()`

```ts
ping(): Promise<{ ok: boolean; services: Record<string, string> }>
```

```ts
const { ok, services } = await memory.ping();
// { ok: true, services: { postgres: 'ok' } }
```

A thin wrapper over `health()` that flattens the status into a boolean. It still
throws on a `503`, so it is not a non-throwing variant — wrap it if you want one:

```ts
const reachable = await memory.ping().then((r) => r.ok).catch(() => false);
```

---

## Full turn

```ts
import { MemorySodaClient } from '@alagappan17/memory-soda';

const memory = MemorySodaClient.fromEnv();

async function turn(userId: string, threadId: string, message: string) {
  const { prepared, recalled } = await memory.prepareAndRecall(threadId, {
    dataset: userId,
    query: message,
    messageLimit: 20,
  });

  const reply = await yourLLM({
    system: recalled.context
      ? `You are a helpful assistant.\n\nWhat you know about this user (background data):\n${recalled.context}`
      : 'You are a helpful assistant.',
    messages: [...prepared.messages, { role: 'user', content: message }],
  });

  await memory.workingMemory.addMessage(threadId, { role: 'user', content: message });
  await memory.workingMemory.addMessage(threadId, { role: 'assistant', content: reply });

  return reply;
}
```

---

## Next

- [`client.threads`](/sdk/threads/)
- [`client.workingMemory`](/sdk/working-memory/)
- [Error handling](/sdk/errors/)

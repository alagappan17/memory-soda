# @memory-soda/sdk

TypeScript client for [memory-soda](https://github.com/your-org/memory-soda) — the memory layer for AI agents. Send conversation messages to a **thread**; get working, episodic, and semantic memory back in a single `prepare` call before each LLM turn.

Ships dual ESM + CJS. Requires Node.js 18+ (uses native `fetch`).

## Installation

```bash
npm install @memory-soda/sdk
```

## Quick start

```ts
import { MemorySodaClient } from '@memory-soda/sdk';

const client = new MemorySodaClient({
  baseUrl: 'http://localhost:3004',
  apiKey: 'ms_your_key_here',
});

// Opening turn: create thread + add message + prepare, in one call
const { threadId, prepare } = await client.startConversation({
  userId: 'user_123',
  firstMessage: { role: 'user', content: 'Book me a table for two tonight' },
});

// `prepare.messages` is ready to hand to any LLM.
const reply = await llm.chat({ messages: prepare.messages });

// Record the reply (idempotency key attached automatically)
await client.workingMemory.addMessage(threadId, {
  role: 'assistant',
  content: reply.text,
});

// Every subsequent turn: prepare before calling the LLM
const ctx = await client.memory.prepare(threadId, { query: 'allergies?' });
// ctx.messages, ctx.context (episodic), ctx.semanticContext (graph facts)
```

## Configuration

```ts
const client = new MemorySodaClient({
  baseUrl: 'https://your-memory-server.com',
  apiKey: 'ms_your_key_here',
  timeout: 60_000, // optional, default 60s
});

// Or from MEMORY_SODA_BASE_URL + MEMORY_SODA_API_KEY:
const client = MemorySodaClient.fromEnv();
```

## Client surface

| Namespace              | Methods                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `client.threads`       | `create`, `list`, `get`, `update`, `end`                                             |
| `client.workingMemory` | `addMessage`, `listMessages`, `compact`, `getThreadStats`                            |
| `client.memory`        | `prepare`, `chat`, `facts`, `entities`, `entityFacts`, `relationships`, `deleteFact` |
| `client`               | `startConversation`, `health`, `ping`                                                |

There is no per-memory-type namespace — working/episodic/semantic memory are derived server-side and surfaced through `prepare`/`chat`; query the semantic graph directly via `client.memory.*`.

## Per-thread settings

Override project defaults for any memory tier at creation; omitted fields inherit the project default:

```ts
await client.threads.create({
  userId: 'user_123',
  settings: {
    working: { autoCompactThreshold: 60 },
    episodic: { recencyWeight: 0.5 },
    semantic: { minConfidence: 0.8 },
  },
});
```

## Resilience

- **Automatic retries** on network errors / `429` / `5xx` with exponential backoff + jitter (honors `Retry-After`); configurable per call via `maxRetries`.
- **Idempotency** — `addMessage` and `chat` attach an `Idempotency-Key` automatically, so retries never double-write.
- **Per-call overrides** — pass `{ timeoutMs, signal }` as the last argument to any method.

```ts
await client.memory.chat(threadId, { content }, { timeoutMs: 120_000 });
```

## Error handling

```ts
import { ApiError, AuthError, NetworkError } from '@memory-soda/sdk';

try {
  await client.threads.get(threadId);
} catch (err) {
  if (err instanceof ApiError) {
    err.status; // 404
    err.code; // 'THREAD_NOT_FOUND'
    err.requestId; // correlate with server logs
  }
}
```

## Documentation

Full guides and reference live in the [developer docs](../../docs/index.md):

- [API Conventions](../../docs/api-conventions.md) — errors, idempotency, pagination
- [Working Memory](../../docs/working-memory/index.md) — threads, messages, prepare, compact
- [Project Settings](../../docs/project-settings/index.md) — memory defaults & overrides
- [SDK Reference](../../docs/working-memory/sdk/index.md)

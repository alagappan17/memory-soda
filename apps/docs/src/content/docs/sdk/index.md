---
title: "SDK reference"
description: "@memory-soda/sdk — a typed, zero-dependency TypeScript client."
---
`@memory-soda/sdk` — a typed, zero-dependency TypeScript client.

---

## Install

```bash
npm install @memory-soda/sdk
```

| | |
|---|---|
| Runtime | Node 18+ (uses global `fetch` and `AbortSignal.timeout`) |
| Formats | ESM and CJS |
| Dependencies | none |
| Types | bundled |

---

## Initialise

```ts
import { MemorySodaClient } from '@memory-soda/sdk';

const memory = new MemorySodaClient({
  baseUrl: 'http://localhost:3004',
  apiKey: process.env.MEMORY_SODA_API_KEY!,
  timeout: 60_000, // optional, default 60s
});
```

Or from the environment:

```ts
const memory = MemorySodaClient.fromEnv();
// reads MEMORY_SODA_BASE_URL and MEMORY_SODA_API_KEY, throws if either is missing
```

> **Server-side only.** The API key grants full read and write access to every
> dataset in its project. Never ship it to a browser or a mobile app.

---

## Shape

```
MemorySodaClient
├── recall(req)                    long-term memory, thread-free
├── prepareAndRecall(threadId, o)  both reads in one call
├── health() / ping()
│
├── threads
│   ├── create(opts)
│   ├── get(threadId)
│   ├── update(threadId, opts)
│   └── end(threadId)
│
├── workingMemory
│   ├── addMessage(threadId, opts)
│   ├── listMessages(threadId, opts)
│   ├── prepare(threadId, opts)
│   ├── compact(threadId)
│   ├── getThreadStats(threadId)
│   └── startConversation(opts)
│
└── semantic
    ├── listFacts(dataset, opts)
    ├── searchFacts(dataset, q, opts)
    ├── deleteFact(dataset, factId)
    ├── listEntities(dataset)
    └── listEntityFacts(dataset, name)
```

| Page | Covers |
|---|---|
| [`MemorySodaClient`](/sdk/client/) | `recall`, `prepareAndRecall`, `health`, `ping`, config |
| [`client.threads`](/sdk/threads/) | thread lifecycle |
| [`client.workingMemory`](/sdk/working-memory/) | messages, prepare, compact, stats |
| [`client.semantic`](/sdk/semantic-memory/) | facts and entities |
| [Error handling](/sdk/errors/) | error classes and retry patterns |
| [Type reference](/sdk/types/) | every exported type |

---

## The minimum you need

For a chat app, four methods:

```ts
const { threadId } = await memory.threads.create({ dataset: userId });

const { context } = await memory.recall({ dataset: userId, query: message });
const { messages } = await memory.workingMemory.prepare(threadId);

await memory.workingMemory.addMessage(threadId, { role: 'user', content: message });
```

Everything else is inspection, curation or convenience.

---

## Conventions

**Every method returns a promise** and throws on failure. Nothing returns `null`
to signal an error — a missing thread is an `ApiError` with `status: 404`.

**Timeouts are per-call**, derived from the client `timeout` via
`AbortSignal.timeout`. A timeout surfaces as a `NetworkError`.

**Nothing is retried automatically.** See [Error handling](/sdk/errors/) for a
retry helper.

**Requests are not batched or deduplicated.** Two identical `recall()` calls make
two HTTP requests and two embedding calls.

---

## Import surface

```ts
import {
  MemorySodaClient,
  ThreadClient,
  WorkingMemoryClient,
  SemanticMemoryClient,
  MemorySodaError,
  ApiError,
  AuthError,
  NetworkError,
} from '@memory-soda/sdk';

import type {
  MemorySodaConfig,
  HealthResponse,
  WMThread, WMCreateThreadRequest, WMCreateThreadResponse,
  WMPatchThreadRequest, WMEndThreadResponse, WMThreadSettings,
  WMMessage, WMAddMessageRequest, WMAddMessageResponse,
  WMListMessagesQuery, WMListMessagesResponse,
  WMPrepareRequest, WMPrepareResponse,
  WMCompactResult, WMThreadStatsResponse, WMTokenUsage, WMTokenCount,
  MessageRole, WMMessageMetadata,
  RecallRequest, RecallResponse, RankedContextGroup,
  SemanticFact, SemanticEntity, EntityType,
  EpisodeContext, EpisodeContextItem,
} from '@memory-soda/sdk';
```

---

## Not in the SDK

Deliberate omissions. Call the HTTP API directly if you need them.

| | Why | Endpoint |
|---|---|---|
| `chat` | A demo endpoint that runs the model server-side. Use `prepare` + `recall` with your own model. | [`POST /v1/memory/working/threads/:id/chat`](/api/working-memory/#chat) |
| Episodic CRUD | Admin surface. Normal reads go through `recall({ include: ['episodes'] })`. | [Episodic memory](/api/episodic-memory/) |
| Projects, API keys, users | Session-authenticated dashboard routes, not integration surface. | [Dashboard routes](/api/dashboard/) |

There is also **no `add()`** — facts cannot be written directly, only derived
from messages. See [Known limitations](/introduction/overview/#known-limitations).

---

## Next

- [`MemorySodaClient`](/sdk/client/)
- [Your first integration](/getting-started/your-first-integration/)

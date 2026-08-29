---
title: "SDK reference"
description: "@alagappan17/memory-soda, a typed, zero-dependency TypeScript client."
---
`@alagappan17/memory-soda`, a typed, zero-dependency TypeScript client.

---

## Install

```bash
npm install @alagappan17/memory-soda
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
import { MemorySoda } from '@alagappan17/memory-soda';

const memory = new MemorySoda({
  baseUrl: 'http://localhost:3004',
  apiKey: process.env.MEMORY_SODA_API_KEY!,
  timeout: 60_000, // optional, default 60s
});
```

Or from the environment:

```ts
const memory = new MemorySoda();
// reads MEMORY_SODA_BASE_URL and MEMORY_SODA_API_KEY, throws if either is missing
```

> **Server-side only.** The API key grants full read and write access to every
> dataset in its project. Never ship it to a browser or a mobile app.

---

## Shape

```
MemorySoda
│
│  Every turn
├── addMessage(threadId, message)      append to the conversation
├── prepare(threadId, opts?)           thread state for the next model call
├── recall(req)                        long-term memory, thread-free
├── prepareAndRecall(threadId, opts?)  both halves at once
│
│  Conversations
├── createThread(opts?)
├── getThread(threadId)
├── updateThread(threadId, opts)
├── endThread(threadId)                cut an episode here
├── addMessages(threadId, messages)
├── listMessages(threadId, opts?)
├── compact(threadId)
│
│  What was learned
├── listFacts(dataset, opts?)
├── deleteFact(dataset, factId)        soft delete
├── listEntities(dataset)
├── listEpisodes(dataset, opts?)
├── searchEpisodes(dataset, q, opts?)
├── getEpisode(episodeId)
│
│  Whole datasets
├── exportDataset(dataset)
├── forgetDataset(dataset)             hard delete
│
└── health()
```

Names carry the tiering: the calls a chat turn makes are short, `recall`,
`prepare`, `addMessage`, and the occasional ones are compound.

A separate subpath, `@alagappan17/memory-soda/ai`, wires all of this into the
Vercel AI SDK, see [AI SDK integration](/sdk/ai-sdk/).

| Page | Covers |
|---|---|
| [`MemorySoda`](/sdk/client/) | constructor, `recall`, `prepareAndRecall`, `health` |
| [Threads](/sdk/threads/) | thread lifecycle |
| [Messages](/sdk/working-memory/) | `addMessage`, `listMessages`, `prepare`, `compact` |
| [Facts and entities](/sdk/semantic-memory/) | `listFacts`, `deleteFact`, `listEntities` |
| [Episodes](/sdk/episodes/) | `listEpisodes`, `searchEpisodes`, `getEpisode` |
| [Datasets](/sdk/datasets/) | export and erase |
| [AI SDK integration](/sdk/ai-sdk/) | middleware, tool, message bridge |

---

## The minimum you need

For a chat app, four methods:

```ts
const { threadId } = await memory.createThread({ dataset: userId });

const { context } = await memory.recall({ dataset: userId, query: message });
const { messages } = await memory.prepare(threadId);

await memory.addMessage(threadId, { role: 'user', content: message });
```

Everything else is inspection, curation or convenience.

---

## Conventions

**Every method returns a promise** and throws on failure. Nothing returns `null`
to signal an error, a missing thread is an `ApiError` with `status: 404`.

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
  MemorySoda,
  ThreadClient,
  WorkingMemoryClient,
  SemanticMemoryClient,
  MemorySodaError,
  ApiError,
  AuthError,
  NetworkError,
} from '@alagappan17/memory-soda';

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
} from '@alagappan17/memory-soda';
```

---

## Not in the SDK

Deliberate omissions. Call the HTTP API directly if you need them.

| | Why | Endpoint |
|---|---|---|
| `chat` | A demo endpoint that runs the model server-side. Use `prepare` + `recall` with your own model. | [`POST /v1/memory/working/threads/:id/chat`](/api/working-memory/#chat) |
| Episodic CRUD | Admin surface. Normal reads go through `recall({ include: ['episodes'] })`. | [Episodic memory](/api/episodic-memory/) |
| Projects, API keys, users | Session-authenticated dashboard routes, not integration surface. | [Dashboard routes](/api/dashboard/) |

There is also **no `add()`**, facts cannot be written directly, only derived
from messages. See [Known limitations](/introduction/overview/#known-limitations).

---

## Next

- [`MemorySoda`](/sdk/client/)
- [Your first integration](/getting-started/your-first-integration/)

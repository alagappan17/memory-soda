# memory-soda — Developer Documentation

A self-hostable memory layer for AI agents. Send it conversations; it extracts
durable facts, resolves contradictions over time, and hands back a
prompt-ready context block before each LLM call.

Postgres and pgvector are the only infrastructure. No vector database, no graph
database, no vendor.

```ts
import { MemorySodaClient } from '@memory-soda/sdk';

const memory = new MemorySodaClient({
  baseUrl: 'http://localhost:3004',
  apiKey: process.env.MEMORY_SODA_API_KEY!,
});

// Before the LLM call — what do we know about this user?
const { context } = await memory.recall({ dataset: 'user_42', query: userMessage });

// After the turn — hand us the conversation, we work out what's worth keeping.
await memory.workingMemory.addMessage(threadId, { role: 'user', content: userMessage });
await memory.workingMemory.addMessage(threadId, { role: 'assistant', content: reply });
```

---

## Start here

| I want to… | Go to |
|---|---|
| Understand what this is and whether I need it | [Overview](./introduction/overview.md) |
| Get it running locally | [Installation](./getting-started/installation.md) |
| See it work in five minutes | [Quickstart](./getting-started/quickstart.md) |
| Wire it into a real app | [Your first integration](./getting-started/your-first-integration.md) |
| Look up a method | [SDK reference](./sdk/index.md) |
| Look up an endpoint | [API reference](./api/index.md) |

---

## Table of contents

### Introduction
- [Overview](./introduction/overview.md) — what memory-soda is, what it is not
- [How it works](./introduction/how-it-works.md) — the write path and the read path
- [Architecture](./introduction/architecture.md) — services, processes, data flow

### Getting started
- [Installation](./getting-started/installation.md) — prerequisites through first boot
- [Quickstart](./getting-started/quickstart.md) — first memory in five minutes
- [Your first integration](./getting-started/your-first-integration.md) — a complete chat turn
- [Configuration](./getting-started/configuration.md) — environment variables and settings

### Concepts
- [Projects and datasets](./concepts/projects-and-datasets.md) — the tenancy model
- [Working memory](./concepts/working-memory.md) — threads, messages, compaction
- [Episodic memory](./concepts/episodic-memory.md) — episodes and summaries
- [Semantic memory](./concepts/semantic-memory.md) — facts and entities
- [The bi-temporal model](./concepts/bi-temporal-model.md) — valid time vs belief time
- [Retrieval](./concepts/retrieval.md) — hybrid search and ranking
- [The extraction pipeline](./concepts/extraction-pipeline.md) — how a message becomes a fact

### SDK reference
- [Overview](./sdk/index.md) — install, initialise, conventions
- [`MemorySodaClient`](./sdk/client.md) — `recall`, `prepareAndRecall`, `health`
- [`client.threads`](./sdk/threads.md) — create, get, update, end
- [`client.workingMemory`](./sdk/working-memory.md) — messages, prepare, compact, stats
- [`client.semantic`](./sdk/semantic-memory.md) — facts and entities
- [Error handling](./sdk/errors.md)
- [Type reference](./sdk/types.md)

### HTTP API reference
- [Conventions](./api/index.md) — base URL, content types, errors, pagination
- [Authentication](./api/authentication.md) — API keys and sessions
- [Threads](./api/threads.md)
- [Working memory](./api/working-memory.md)
- [Recall](./api/recall.md)
- [Semantic memory](./api/semantic-memory.md)
- [Episodic memory](./api/episodic-memory.md)
- [Dashboard routes](./api/dashboard.md)

### Dashboard
- [Overview](./dashboard/index.md)
- [Users and sign-in](./dashboard/users-and-auth.md)
- [Projects](./dashboard/projects.md)
- [API keys](./dashboard/api-keys.md)
- [Datasets](./dashboard/datasets.md)
- [Playground](./dashboard/playground.md)
- [Project settings](./dashboard/project-settings.md)

### Guides
- [Build a chatbot with memory](./guides/build-a-chatbot.md)
- [Handling long conversations](./guides/long-conversations.md)
- [Curating and correcting memory](./guides/curating-memory.md)
- [Point-in-time recall](./guides/point-in-time-recall.md)
- [Tuning retrieval quality](./guides/tuning-retrieval.md)

### Operations
- [Self-hosting](./operations/self-hosting.md)
- [Database migrations](./operations/migrations.md)
- [Background jobs](./operations/background-jobs.md)
- [Privacy and data deletion](./operations/privacy-and-deletion.md)

### Reference
- [Environment variables](./reference/environment-variables.md)
- [Database schema](./reference/database-schema.md)
- [Project settings](./reference/project-settings.md)
- [Errors](./reference/errors.md)
- [Limits and defaults](./reference/limits.md)

### Contributing
- [Development setup](./contributing/development.md)
- [Testing](./contributing/testing.md)
- [Releasing the SDK](./contributing/releasing.md)

---

## Status

memory-soda is pre-1.0 and self-hosted only. There is no hosted offering.

The API surface described here is what exists today. Some of it is known to be
larger than it should be — see [Known limitations](./introduction/overview.md#known-limitations)
for an honest list of what is missing and what is likely to change.

## License

MIT.

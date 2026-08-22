# @alagappan17/memory-soda

Memory layer SDK for AI agents. Store, retrieve, and manage user memories across conversations.

## Installation

```bash
npm install @alagappan17/memory-soda
```

Requires Node.js 18+ (uses native `fetch`).

## Quick start

```ts
import { MemorySodaClient } from '@alagappan17/memory-soda';

const memory = new MemorySodaClient({
  baseUrl: 'http://localhost:3004',
  apiKey: 'your-api-key',
});

// Store a memory
await memory.store('user-123', 'The user prefers concise responses');

// Retrieve relevant memories for a query
const results = await memory.retrieve('user-123', 'communication style');
// results[0].memory.content => 'The user prefers concise responses'
// results[0].score => 0.92

// List all memories for a user
const all = await memory.list('user-123');

// Delete a specific memory
await memory.delete('user-123', memoryId);

// Delete all memories for a user
await memory.deleteAll('user-123');
```

## Configuration

### Direct instantiation

```ts
const memory = new MemorySodaClient({
  baseUrl: 'https://your-memory-server.com',
  apiKey: 'your-api-key',
  timeout: 30_000, // optional, default 30s
});
```

### From environment variables

```ts
// Reads MEMORY_SODA_BASE_URL and MEMORY_SODA_API_KEY from process.env
const memory = MemorySodaClient.fromEnv();
```

## Running the server

Requires a local PostgreSQL instance with the [pgvector](https://github.com/pgvector/pgvector) extension.

```bash
git clone https://github.com/your-org/memory-soda
cd memory-soda
npm install
cp .env.example .env                    # set DATABASE_URL and GOOGLE_GENERATIVE_AI_API_KEY
npm run --workspace=apps/api db:migrate # apply migrations
npm run dev                             # api + dashboard
```

See the [repo README](https://github.com/your-org/memory-soda#quickstart) for full Postgres setup steps.

Dashboard is available at `http://localhost:3000`.
API is available at `http://localhost:3004`.

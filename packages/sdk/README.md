# @memory-soda/sdk

Memory layer SDK for AI agents. Store, retrieve, and manage user memories across conversations.

## Installation

```bash
npm install @memory-soda/sdk
```

Requires Node.js 18+ (uses native `fetch`).

## Quick start

```ts
import { MemorySodaClient } from '@memory-soda/sdk';

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

### Local development (Docker)

```bash
git clone https://github.com/your-org/memory-soda
cd memory-soda
docker compose up -d                    # databases
npm install && npm run dev              # api + dashboard
```

### Self-hosted production

```bash
cp .env.prod.example .env.prod          # fill in secrets
docker compose -f docker/docker-compose.prod.yml up -d
```

Dashboard is available at `http://localhost:3000`.
API is available at `http://localhost:3004`.

# memory-soda

Semantic memory layer for AI agents. Extract facts from conversations, store them in Postgres, and retrieve relevant context for future LLM calls. Powered by pgvector similarity search. Self-hostable.

---

## Quickstart

```bash
npm create memory-soda@latest
```

Asks for a folder, a Gemini API key, your `DATABASE_URL`, and which ports to
use — then clones, configures, installs, and checks that the database is
reachable with pgvector available. Then `cd` in and `npm run dev`.

You bring the Postgres; see the prerequisites below.

---

## Manual setup

**Prerequisites:** Node 20+ and a local PostgreSQL instance with the [pgvector](https://github.com/pgvector/pgvector) extension available.

```bash
git clone https://github.com/alagappan17/memory-soda
cd memory-soda
npm install

# Create the database, role, and extension (one-time setup)
createdb memory_db
psql -d memory_db -c "CREATE ROLE memory_user LOGIN PASSWORD 'memory_pass';"
psql -d memory_db -c "CREATE EXTENSION IF NOT EXISTS vector;"
psql -d memory_db -c "ALTER DATABASE memory_db OWNER TO memory_user;"

cp .env.example .env
# Fill in GOOGLE_GENERATIVE_AI_API_KEY and point DATABASE_URL at your Postgres

# Apply migrations, then start the API + Dashboard
npm run --workspace=apps/api db:migrate
npm run dev
```

On first boot the API prints a key to its logs — copy it before it scrolls away:

```
┌─────────────────────────────────────────────────┐
│  Memory Soda — First-time setup                 │
│                                                 │
│  API Key: ms_xxxxxxxxxxxxxxxxxxxxxxxxxxxx       │
│                                                 │
│  Save this — it will not be shown again.        │
└─────────────────────────────────────────────────┘
```

If you missed it, the key is stored in the `api_keys` table — or wipe it and restart to print a fresh one.

| Service | URL |
|---|---|
| Dashboard | http://localhost:3000 |
| API | http://localhost:3004 |
| Status page | http://localhost:3000/status |

Open the **Status page** first to confirm all services (Postgres) are green before integrating the SDK.

---

## Use the SDK

### Install from npm

```bash
npm install @memory-soda/sdk
```

```ts
import { MemorySodaClient } from '@memory-soda/sdk';

const memory = new MemorySodaClient({
  baseUrl: 'http://localhost:3004',   // your self-hosted API URL
  apiKey: 'ms_xxxx',                  // key from first-boot output
});

// Verify connectivity
const { ok, services } = await memory.ping();

// Store facts from a conversation turn
await memory.add(userId, messages);

// Retrieve relevant context before an LLM call
const { contextText } = await memory.retrieve(userId, userMessage);

// Or let memory-soda handle the full agent turn end-to-end
const response = await memory.chat(userId, messages);
```

Or use environment variables:

```bash
MEMORY_SODA_BASE_URL=http://localhost:3004
MEMORY_SODA_API_KEY=ms_xxxx
```

```ts
const memory = MemorySodaClient.fromEnv();
```

### Install locally (pre-publish / contributors)

**Option A — npm link** (recommended while actively developing the SDK)

```bash
# In this repo — build and register globally
cd packages/sdk && npm run build && cd ../..
npm link --workspace=packages/sdk

# In your app
npm link @memory-soda/sdk

# When you change SDK code, just rebuild — the link picks up the new dist:
npm run sdk:build
```

**Option B — file path** (stable snapshot, no global symlink)

```bash
# In your app's package.json:
"@memory-soda/sdk": "file:../memory-soda/packages/sdk"

npm install

# After SDK changes: rebuild then reinstall in your app
npm run sdk:build          # in this repo
npm install                # in your app
```

---

## Local development

Follow the [Quickstart](#quickstart) to set up Postgres and env vars, then:

```bash
npm run dev   # API + Dashboard, hot reload
```

Common database tasks (run from `apps/api`):

```bash
npm run db:generate   # generate a migration from schema changes
npm run db:migrate    # apply pending migrations
npm run db:studio     # open Drizzle Studio
```

---

## Project structure

```
apps/
  api/          ← self-hostable Express/Fastify backend (Postgres + Gemini)
  dashboard/    ← memory management dashboard (Next.js)

packages/
  sdk/          ← @memory-soda/sdk — install this in your app
  types/        ← shared TypeScript types (internal)
```

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_GENERATIVE_AI_API_KEY` | **Yes** | Gemini API key — [get one at aistudio.google.com](https://aistudio.google.com) |
| `DATABASE_URL` | **Yes** | Postgres connection string (database must have the `vector` extension). |
| `HOST` | No | API bind address. Default: `localhost` |
| `PORT` | No | API port. Default: `3004` |
| `CORS_ORIGIN` | No | Dashboard URL for CORS. Default: `http://localhost:3000` |
| `MIGRATE_ON_START` | No | Run DB migrations on startup. Default: `true` |
| `NEXT_PUBLIC_API_URL` | No | API URL as seen from the browser. Default: `http://localhost:3004` |

Copy `.env.example` to `.env` for local development.

---

## Development commands

| Command | Description |
|---|---|
| `npm run dev` | Start API + Dashboard in watch mode |
| `npm run build` | Build all projects |
| `npm run typecheck` | Type-check all projects |
| `npm run sdk:build` | Build the SDK package |

---

## Publishing the SDK

The SDK publishes to npm automatically when a `v*` tag is pushed. Requires `NPM_TOKEN` set as a GitHub Actions secret.

```bash
git tag v0.2.0
git push origin v0.2.0
```

# Memory Soda

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

Sign in to the dashboard with `admin` / `open-sesame`, change the password when
prompted, and create an API key under **API Keys**.

### Updating

```bash
npm run update   # git pull upstream main && npm install
npm run dev      # migrations apply on boot
```

`.env` is gitignored, so your config survives the pull.

The installer names the public repo `upstream` and leaves `origin` free for
your own repo — the one your host deploys from:

```bash
git remote add origin git@github.com:you/memory-soda.git
git push -u origin main
```

| Service     | URL                          |
| ----------- | ---------------------------- |
| Dashboard   | http://localhost:3000        |
| API         | http://localhost:3004        |
| Status page | http://localhost:3000/status |

Open the **Status page** first to confirm all services (Postgres) are green before integrating the SDK.

---

## Use the SDK

```bash
npm install @memory-soda/sdk
```

```ts
import { MemorySoda } from '@memory-soda/sdk';

const memory = new MemorySoda({
  baseUrl: 'http://localhost:3004', // your self-hosted API
  apiKey: 'ms_xxxx', // from the first-boot output
});
```

Or set `MEMORY_SODA_BASE_URL` and `MEMORY_SODA_API_KEY` and call
`new MemorySoda()` with no arguments.

### The loop

Memory is written by having the conversation and read by asking for it back.

```ts
// Once per conversation. `dataset` is whose memory this is — a user id works.
const { threadId, dataset } = await memory.createThread({ dataset: 'user_42' });

// Every turn: write what was said…
await memory.addMessage(threadId, { role: 'user', content: input });

// …and read what matters, as a prompt-ready block.
const { context } = await memory.recall({ dataset, query: input });

const reply = await yourModel({
  system: context ? `What you know about this user:\n${context}` : undefined,
  prompt: input,
});

await memory.addMessage(threadId, { role: 'assistant', content: reply });
```

Facts are extracted in the background — you never call an "extract" endpoint.
A few seconds after a burst of messages, `recall()` starts returning what the
conversation revealed.

### With the Vercel AI SDK

Wrap the model once and memory becomes invisible: it recalls before every call
and records every turn.

```ts
import { google } from '@ai-sdk/google';
import { generateText, wrapLanguageModel } from 'ai';
import { memoryMiddleware } from '@memory-soda/sdk/ai';

const model = wrapLanguageModel({
  model: google('gemini-2.5-flash'),
  middleware: memoryMiddleware({ memory, dataset, threadId }),
});

const { text } = await generateText({ model, prompt: 'What should I cook?' });
```

A recall failure degrades to an unaugmented call rather than throwing, and the
write-back never blocks the response. There is also `memoryTool()` for agents
that should decide when to look something up themselves.

### The rest

```ts
await memory.listFacts('user_42'); // what is known, most recent first
await memory.deleteFact('user_42', factId); // retire something we got wrong
await memory.exportDataset('user_42'); // everything held, for a SAR
await memory.forgetDataset('user_42'); // erase it, for real
```

> **Server-side only.** An API key grants full read and write access to every
> dataset in its project. Never ship it to a browser or a mobile app.

### Environments

The SDK is the same everywhere; only `baseUrl` changes. Point it at
`http://localhost:3004` in development and at your deployed API in production:

```ts
const memory = new MemorySoda({
  baseUrl: process.env.MEMORY_SODA_URL,
  apiKey: process.env.MEMORY_SODA_API_KEY,
});
```

---

## Local development

Follow the [Quickstart](#quickstart) to set up Postgres and env vars, then:

```bash
npm run dev   # API + Dashboard, hot reload
```

Common database tasks:

```bash
npm run db:generate                        # generate a migration from schema changes
npm run db:migrate                         # apply pending migrations
npm run --workspace=apps/api db:studio     # open Drizzle Studio
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request.

---

## Project structure

```
apps/
  api/          ← Express API: the memory pipeline, Drizzle schema, worker
  dashboard/    ← Vite + React dashboard and playground
  docs/         ← Astro Starlight documentation site

packages/
  sdk/          ← @memory-soda/sdk — install this in your app
  types/        ← shared types and settings defaults (internal)
  create-memory-soda/ ← the `npm create memory-soda` installer
```

---

## Environment variables

| Variable                       | Required | Description                                                                    |
| ------------------------------ | -------- | ------------------------------------------------------------------------------ |
| `GOOGLE_GENERATIVE_AI_API_KEY` | **Yes**  | Gemini API key — [get one at aistudio.google.com](https://aistudio.google.com) |
| `DATABASE_URL`                 | **Yes**  | Postgres connection string (database must have the `vector` extension).        |
| `HOST`                         | No       | API bind address. Default: `localhost`                                         |
| `PORT`                         | No       | API port. Default: `3004`                                                      |
| `CORS_ORIGIN`                  | No       | Dashboard URL for CORS. Default: `http://localhost:3000`                       |
| `MIGRATE_ON_START`             | No       | Run DB migrations on startup. Default: `true`                                  |
| `VITE_API_URL`                 | No       | API URL as seen from the browser. Default: `http://localhost:3004`             |

Copy `.env.example` to `.env` for local development.

---

## Development commands

| Command              | Description                         |
| -------------------- | ----------------------------------- |
| `npm run dev`        | Start API + Dashboard in watch mode |
| `npm run build`      | Build all projects                  |
| `npm run typecheck`  | Type-check all projects             |
| `npm run test`       | Run the test suites                 |
| `npm run lint`       | Lint everything                     |
| `npm run sdk:build`  | Build the SDK package               |
| `npm run db:migrate` | Apply pending migrations            |

---

## Publishing the SDK

The SDK is published locally: bump `packages/sdk/package.json`, then `npm run sdk:publish`.

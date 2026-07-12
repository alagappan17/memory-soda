# memory-soda

Semantic memory layer for AI agents. Extract facts from conversations, store them in Postgres, and retrieve relevant context for future LLM calls. Powered by pgvector similarity search. Self-hostable.

---

## Self-host (Docker)

```bash
git clone https://github.com/your-org/memory-soda
cd memory-soda
cp .env.example .env
# Fill in GOOGLE_GENERATIVE_AI_API_KEY in .env
docker compose up -d
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

```bash
docker compose logs api   # retrieve it again if you missed it
```

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

```bash
# Start infra (Postgres) — no app containers
docker compose -f docker-compose.dev.yml up -d

cp .env.example .env
# Fill in GOOGLE_GENERATIVE_AI_API_KEY

# Run API + Dashboard natively (hot reload)
npm install
npm run dev
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

docker/
  Dockerfile.api
  Dockerfile.dashboard
  docker-compose.prod.yml   ← production stack (no exposed DB ports)

docker-compose.yml          ← self-hosting entrypoint (all ports exposed)
docker-compose.dev.yml      ← infra only, for local development
```

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_GENERATIVE_AI_API_KEY` | **Yes** | Gemini API key — [get one at aistudio.google.com](https://aistudio.google.com) |
| `HOST` | No | API bind address. Default: `localhost` (use `0.0.0.0` in Docker) |
| `PORT` | No | API port. Default: `3004` |
| `CORS_ORIGIN` | No | Dashboard URL for CORS. Default: `http://localhost:3000` |
| `MIGRATE_ON_START` | No | Run DB migrations on startup. Default: `true` |
| `DATABASE_URL` | No | Postgres connection string. Default: matches docker-compose |
| `NEXT_PUBLIC_API_URL` | No | API URL as seen from the browser. Default: `http://localhost:3004` |

Copy `.env.example` for local development. See `.env.prod.example` for production variables.

---

## Development commands

| Command | Description |
|---|---|
| `npm run dev` | Start API + Dashboard in watch mode |
| `npm run build` | Build all projects |
| `npm run typecheck` | Type-check all projects |
| `npm run sdk:build` | Build the SDK package |
| `npm run docker:up` | `docker compose up -d` |
| `npm run docker:down` | `docker compose down` |

---

## Publishing the SDK

The SDK publishes to npm automatically when a `v*` tag is pushed. Requires `NPM_TOKEN` set as a GitHub Actions secret.

```bash
git tag v0.2.0
git push origin v0.2.0
```

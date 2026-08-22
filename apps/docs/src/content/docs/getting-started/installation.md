---
title: "Installation"
description: "memory-soda is self-hosted. You run Postgres, you bring a Gemini API key."
---
memory-soda is self-hosted. You run Postgres, you bring a Gemini API key.

---

## The short way

```bash
npm create memory-soda@latest
```

The installer asks for a folder name, your Gemini API key, how you want Postgres,
and the dashboard admin login — then clones the repo, writes `.env`, optionally
starts a pgvector container, and installs dependencies. Skip to
[Quickstart](/getting-started/quickstart/) once it finishes.

Choosing the container answers the pgvector question for you: the image ships
the extension and connects as a superuser, so the first migration creates it
without any manual `psql`.

> Planning to send patches? Clone instead. The installer removes `.git` so your
> project is not a fork of this repo — see
> [Development setup](/contributing/development/).

Everything below is the same setup done by hand.

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 20 or newer | 22+ recommended |
| PostgreSQL | 14 or newer | must have the [pgvector](https://github.com/pgvector/pgvector) extension available |
| Gemini API key | — | free tier is enough to evaluate — [aistudio.google.com](https://aistudio.google.com) |

### Installing pgvector

<details>
<summary>macOS (Homebrew)</summary>

```bash
brew install pgvector
# If you installed Postgres via Homebrew, that's it. Otherwise build from source:
#   git clone https://github.com/pgvector/pgvector && cd pgvector && make && sudo make install
```
</details>

<details>
<summary>Debian / Ubuntu</summary>

```bash
sudo apt install postgresql-16-pgvector   # match your server major version
```
</details>

<details>
<summary>Docker</summary>

```bash
docker run -d --name memory-pg \
  -e POSTGRES_PASSWORD=memory_pass \
  -e POSTGRES_USER=memory_user \
  -e POSTGRES_DB=memory_db \
  -p 5432:5432 \
  pgvector/pgvector:pg16
```
</details>

Verify it is available:

```bash
psql -d postgres -c "SELECT * FROM pg_available_extensions WHERE name = 'vector';"
```

---

## 1. Clone and install

```bash
git clone https://github.com/alagappan17/memory-soda
cd memory-soda
npm install
```

---

## 2. Create the database

```bash
createdb memory_db
psql -d memory_db -c "CREATE ROLE memory_user LOGIN PASSWORD 'memory_pass';"
psql -d memory_db -c "CREATE EXTENSION IF NOT EXISTS vector;"
psql -d memory_db -c "ALTER DATABASE memory_db OWNER TO memory_user;"
```

> `CREATE EXTENSION` requires superuser on most installations. Run it as your
> Postgres superuser, not as `memory_user`.

---

## 3. Configure

```bash
cp .env.example .env
```

Edit `.env` — only two values are required:

```bash
# Required
DATABASE_URL=postgresql://memory_user:memory_pass@localhost:5432/memory_db
GOOGLE_GENERATIVE_AI_API_KEY=your_key_here

# Optional, shown with defaults
HOST=localhost
PORT=3004
CORS_ORIGIN=http://localhost:3000
MIGRATE_ON_START=true
```

Full list: [Environment variables](/reference/environment-variables/).

---

## 4. Apply migrations

With `MIGRATE_ON_START=true` this happens automatically on boot. To run it
explicitly:

```bash
npm run --workspace=apps/api db:migrate
```

---

## 5. Start

```bash
npm run dev
```

This runs the API and the dashboard together with hot reload.

On **first boot only**, credentials are printed once:

```
┌───────────────────────────────────────────────────────┐
│  Memory Soda — First-time setup                       │
│                                                       │
│  API Key:  ms_3f9a…                                   │
│  Login:    admin / kR7v-2mQxPd1                       │
│            (generated — set ADMIN_PASSWORD to choose) │
│                                                       │
│  Save these — the API key will not be shown again.    │
└───────────────────────────────────────────────────────┘
```

**Copy both before the log scrolls.**

- The **API key** is hashed at rest and cannot be recovered. If you lose it,
  issue a new one from the dashboard's API Keys page.
- The **admin password** is randomly generated unless you set `ADMIN_PASSWORD`.
  It is not recoverable either, but you can create another user from the
  dashboard, or insert one directly.

| Service | URL |
|---|---|
| Dashboard | http://localhost:3000 |
| API | http://localhost:3004 |
| Health check | http://localhost:3004/health |

---

## 6. Verify

```bash
curl http://localhost:3004/health
```

```json
{ "status": "ok", "services": { "postgres": "ok" } }
```

Then sign in to the dashboard at http://localhost:3000 and open **Status**.

---

## Installing the SDK in your app

```bash
npm install @memory-soda/sdk
```

```ts
import { MemorySodaClient } from '@memory-soda/sdk';

const memory = new MemorySodaClient({
  baseUrl: 'http://localhost:3004',
  apiKey: 'ms_…',
});
```

### Working against a local checkout

While developing the SDK itself, link it rather than publishing:

```bash
# in this repo
npm run sdk:build
npm link --workspace=packages/sdk

# in your app
npm link @memory-soda/sdk
```

After changing SDK source, `npm run sdk:build` is enough — the link picks up the
new `dist`.

Alternatively, pin a file path in your app's `package.json`:

```json
{ "dependencies": { "@memory-soda/sdk": "file:../memory-soda/packages/sdk" } }
```

---

## Troubleshooting

**`GOOGLE_GENERATIVE_AI_API_KEY environment variable is required but not set`**
The API throws at import time without it. It is required even for endpoints that
never call a model.

**`extension "vector" is not available`**
pgvector is not installed for your Postgres *major version*. Installing it for
16 does not help a 15 server.

**`Error: listen EADDRINUSE :::3004`**
Something is already on the port. `lsof -ti:3004 | xargs kill`, or set `PORT`.

**Dashboard starts on port 3001**
Vite fell back because 3000 was taken. Free it, or set `VITE_API_URL` in the
dashboard and update `CORS_ORIGIN` to match the port you land on.

**CORS errors in the browser**
`CORS_ORIGIN` must exactly match the dashboard's origin, including port. Multiple
origins are comma-separated.

**Migrations fail with a permissions error**
`memory_user` must own the database: `ALTER DATABASE memory_db OWNER TO memory_user;`

---

## Next

- [Quickstart](/getting-started/quickstart/) — store and recall your first memory
- [Configuration](/getting-started/configuration/) — every knob

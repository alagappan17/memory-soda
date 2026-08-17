---
title: "Environment variables"
description: "Read from .env in the repo root during development, and from the process environment in production."
---
Read from `.env` in the repo root during development, and from the process
environment in production.

---

## API server

### Required

| Variable | Description |
|---|---|
| `DATABASE_URL` | Postgres connection string. The database must have the `vector` extension. |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini API key. |

```bash
DATABASE_URL=postgresql://memory_user:memory_pass@localhost:5432/memory_db
GOOGLE_GENERATIVE_AI_API_KEY=AIza…
```

> **`GOOGLE_GENERATIVE_AI_API_KEY` is checked at module import.** The process
> throws and exits without it, even for endpoints that never call a model. There
> is no way to run memory-soda without a Gemini key.

`DATABASE_URL` accepts the standard libpq form, including `?sslmode=require`:

```bash
DATABASE_URL=postgresql://user:pass@db.example.com:5432/memory?sslmode=require
```

### Optional

| Variable | Default | Description |
|---|---|---|
| `HOST` | `localhost` | Bind address. **Set to `0.0.0.0` in a container** or nothing external can connect. |
| `PORT` | `3004` | |
| `CORS_ORIGIN` | `http://localhost:3000` | Allowed browser origin(s), comma-separated. Never `*` in production. |
| `MIGRATE_ON_START` | `true` | Run pending migrations before opening the listener. |
| `ADMIN_USERNAME` | `admin` | Username for the first-boot admin user. |
| `ADMIN_PASSWORD` | *randomly generated* | Password for that user, printed once. |

#### `CORS_ORIGIN`

```bash
CORS_ORIGIN=https://memory.example.com
CORS_ORIGIN=http://localhost:3000,https://memory.example.com
```

Must match the dashboard origin exactly, **including port**. A dashboard on
`:3001` after a Vite port fallback will fail CORS against a default of `:3000`.

#### `MIGRATE_ON_START`

`true` is right for a single instance. With several replicas booting together
they race — safely, because Drizzle takes a lock, but slowly. For a fleet, set it
to `false` and migrate as a deploy step. See [Migrations](/operations/migrations/).

#### `ADMIN_PASSWORD`

Only used on an empty database, when the first admin user is seeded.

**Leave it unset in production.** A random password is generated and printed once
— safer than a value that ends up in your deployment config and shell history.

```
Login:    admin / kR7v-2mQxPd1
          (generated — set ADMIN_PASSWORD to choose)
```

Neither the generated password nor the API key is recoverable after the log
scrolls.

---

## Dashboard

Build-time only. Vite inlines these into the bundle.

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3004` | API URL **as the browser sees it**. |

```bash
VITE_API_URL=https://api.memory.example.com npm run build
```

> This is the browser's view, not the server's. `http://api:3004` works inside a
> Docker network and is useless to a user's browser.
>
> Changing it requires a **rebuild** — it is not read at runtime.

---

## SDK (your application)

Read by `MemorySodaClient.fromEnv()` in your app, not by the server.

| Variable | Description |
|---|---|
| `MEMORY_SODA_BASE_URL` | e.g. `https://api.memory.example.com` |
| `MEMORY_SODA_API_KEY` | `ms_…` |

```ts
const memory = MemorySodaClient.fromEnv();
```

Throws a plain `Error` if either is missing — a startup misconfiguration, not a
runtime failure.

---

## Full `.env.example`

```bash
# ── Server ───────────────────────────────────────────────────────────
HOST=localhost
PORT=3004
CORS_ORIGIN=http://localhost:3000

# Run DB migrations automatically on startup (required on first boot)
MIGRATE_ON_START=true

# ── PostgreSQL ───────────────────────────────────────────────────────
# Requires the pgvector extension — `CREATE EXTENSION vector;`
DATABASE_URL=postgresql://memory_user:memory_pass@localhost:5432/memory_db

# ── Google Gemini (required) ─────────────────────────────────────────
# https://aistudio.google.com
GOOGLE_GENERATIVE_AI_API_KEY=

# ── Dashboard (build time) ───────────────────────────────────────────
VITE_API_URL=http://localhost:3004

# ── First-boot admin (optional) ──────────────────────────────────────
# Leave ADMIN_PASSWORD unset to have one generated and printed once.
# ADMIN_USERNAME=admin
# ADMIN_PASSWORD=
```

---

## Not configurable

Hard-coded in the source. Changing them means editing code.

| Setting | Value | Location |
|---|---|---|
| LLM model | `gemini-2.5-flash` | `apps/api/src/lib/gemini.ts` |
| Embedding model | `gemini-embedding-001` | same |
| Embedding dimensions | `768` | same, **and baked into the schema** |
| Text call timeout | 30 s | same |
| Structured call timeout | 90 s | same |
| Embedding batch size | 100 | same |
| Postgres pool max | 20 | `apps/api/src/db/postgres.ts` |
| Pool idle timeout | 30 s | same |
| Pool connection timeout | 2 s | same |
| Job intervals | 5 s / 120 s / 120 s | `apps/api/src/main.ts` |
| Stale claim window | 10 min | `apps/api/src/services/semantic-memory.service.ts` |
| Semantic retry cap | 3 | same |
| Rows per job tick | 20 | various |
| Request body limit | 1 MB | `apps/api/src/main.ts` |
| Session lifetime | 7 days | `apps/api/src/services/session.service.ts` |
| scrypt parameters | `N=2^15, r=8, p=3` | `apps/api/src/lib/password.ts` |

Changing the embedding dimension is not a config change — it requires a migration
and re-embedding every stored vector.

---

## Precedence and loading

The API reads `process.env` directly. It does **not** load `.env` itself — that
comes from the Nx dev server during `npm run dev`.

In production, supply variables through your process manager, container runtime
or secret store. A `.env` file sitting next to a production build will be
ignored.

---

## Validating a deployment

```bash
# required present?
node -e "for (const k of ['DATABASE_URL','GOOGLE_GENERATIVE_AI_API_KEY']) if (!process.env[k]) { console.error('missing', k); process.exit(1) } console.log('ok')"

# database reachable, extension present?
psql "$DATABASE_URL" -c "SELECT extname FROM pg_extension WHERE extname = 'vector';"

# API healthy?
curl -fsS "http://$HOST:$PORT/health" | jq
```

---

## Next

- [Configuration](/getting-started/configuration/) — runtime settings
- [Self-hosting](/operations/self-hosting/)
- [Project settings](/reference/project-settings/)

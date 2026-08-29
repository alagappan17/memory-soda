---
title: "Self-hosting"
description: "Memory Soda is self-hosted only. There is no managed offering."
---
Memory Soda is self-hosted only. There is no managed offering.

---

## What you are running

| Component | Notes |
|---|---|
| **API** | One Node process. Express, stateless except for in-process timers. |
| **Dashboard** | Static assets from a Vite build. Any static host will do. |
| **PostgreSQL** | With `pgvector`. The only datastore. |
| **Gemini API** | External dependency. Required to boot. |

No queue, no cache, no worker pool, no object storage.

---

## Sizing

The API is IO-bound, it waits on Postgres and on Gemini. Extraction runs
in-process but is mostly network wait.

| Deployment | API | Postgres |
|---|---|---|
| Evaluation, one developer | 0.5 vCPU, 512 MB | shared, 1 GB |
| Small production, < 10k datasets | 1 vCPU, 1 GB | 2 vCPU, 4 GB, SSD |
| Larger | 2 vCPU, 2 GB | scale Postgres first, it is always the bottleneck |

Two memory notes:

- Password hashing uses **32 MiB per concurrent sign-in** (scrypt `N=2^15`).
  Dashboard traffic is low, but do not run the API in a 256 MB container.
- The extraction pipeline loads **all live facts for a dataset** into process
  memory, embeddings included. A dataset with 10,000 facts is roughly 30 MB per
  extraction run. See [Limits](/reference/limits/).

---

## Run one API instance

> **The background jobs assume a single process.**

Three `setInterval` jobs run in-process: scheduled episodes (5 s), failed-episode
retry (120 s) and the semantic sweep (120 s). Work is claimed atomically, so
duplicates do not corrupt data, but N replicas do N times the polling and N
times the wake-ups, with no leader election.

Scale vertically, or run one instance and accept it. If you need more, add
`pg_try_advisory_lock` around each tick, a few lines. See
[Background jobs](/operations/background-jobs/).

---

## Deployment

### Build

```bash
npm ci
npm run build          # api + dashboard + sdk + types
```

Outputs:

```
apps/api/dist/         node apps/api/dist/apps/api/src/main.js
apps/dashboard/dist/   static files
```

### Run the API

```bash
NODE_ENV=production \
HOST=0.0.0.0 \
PORT=3004 \
DATABASE_URL=postgresql://… \
GOOGLE_GENERATIVE_AI_API_KEY=… \
CORS_ORIGIN=https://memory.example.com \
MIGRATE_ON_START=true \
node apps/api/dist/apps/api/src/main.js
```

`HOST=0.0.0.0` is required in a container, the default `localhost` will not
accept external connections.

### Serve the dashboard

`apps/dashboard/dist/` is a static SPA. Any host works, with two requirements:

1. **SPA fallback**, rewrite unknown paths to `index.html`, or deep links 404.
2. **`VITE_API_URL` at build time**, it is baked into the bundle and must be the
   URL **the browser** can reach, not the one the server uses.

```bash
VITE_API_URL=https://api.memory.example.com npm run build
```

Nginx:

```nginx
server {
  listen 443 ssl;
  server_name memory.example.com;
  root /srv/memory-soda/dashboard;

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

### Dockerfile

```dockerfile
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
COPY apps apps
COPY packages packages
COPY nx.json tsconfig*.json ./
RUN npm ci && npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3004
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/drizzle ./apps/api/drizzle
EXPOSE 3004
CMD ["node", "apps/api/dist/apps/api/src/main.js"]
```

Copy `drizzle/`, the migrator reads the SQL files at runtime when
`MIGRATE_ON_START=true`.

---

## Postgres

### Required extension

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Superuser, once per database, before the first migration.

### Managed providers

| Provider | pgvector |
|---|---|
| AWS RDS / Aurora | 15.2+ / 14.7+ |
| Google Cloud SQL | 14+ |
| Azure Database | 11+ |
| Supabase, Neon | enabled by default |

### Connection pool

Fixed in code: `max: 20`, 30 s idle timeout, 2 s connection timeout. Not
configurable. Provision at least 25 connections for the API, plus headroom for
migrations and your own tooling.

### A note on failure behaviour

An unexpected idle-client error calls `process.exit(1)`. A Postgres failover will
take the API down rather than reconnecting. **Run it under a supervisor that
restarts**, systemd, Docker `--restart`, a Kubernetes Deployment.

---

## Health checks

```bash
curl http://localhost:3004/health
```

`200` with `{"status":"ok"}`, or `503`.

It verifies Postgres answers `SELECT 1`. It does **not** check Gemini
reachability, migration state, or whether extraction is keeping up. A green
health check is compatible with every episode failing.

Kubernetes:

```yaml
livenessProbe:
  httpGet: { path: /health, port: 3004 }
  initialDelaySeconds: 20
  periodSeconds: 30
readinessProbe:
  httpGet: { path: /health, port: 3004 }
  initialDelaySeconds: 5
  periodSeconds: 10
```

Boot takes a few seconds, migrations run before the listener opens.

---

## Security

Memory Soda expects to sit **behind your own boundary**. Put a reverse proxy in
front of it.

### What it does not do

| Missing | Mitigation |
|---|---|
| TLS | Terminate at the proxy |
| Rate limiting, including `/auth/login` | Rate-limit at the proxy |
| Per-dataset or read-only API keys | One project per tenant |
| API key expiry | Rotate manually |
| Audit logging | Log at the proxy |
| Roles or permissions | Every dashboard user is a full admin |

### Checklist

- [ ] TLS terminated in front
- [ ] Rate limits on `/auth/login` and `/v1/*`
- [ ] `CORS_ORIGIN` set to the exact dashboard origin, never `*`
- [ ] `ADMIN_PASSWORD` unset in production so a random one is generated, or set
      to something strong
- [ ] Postgres not publicly reachable
- [ ] `GOOGLE_GENERATIVE_AI_API_KEY` in a secret store
- [ ] Dashboard on a trusted origin, the session token lives in `localStorage`
- [ ] One API key per environment and service

---

## Logging

Plain `console` output plus `morgan` in `dev` format. No structured logging, no
log levels, no request IDs.

> **`prepare()` and `recall()` log their full payloads at info level**, which
> means **user message content and recalled facts go to stdout**. If you ship
> logs anywhere, they contain personal data. Filter at the collector, or patch
> those two `console.log` calls out before deploying.

---

## Backups

Everything lives in Postgres.

```bash
pg_dump "$DATABASE_URL" --format=custom --file=memory-$(date +%F).dump
pg_restore --dbname="$DATABASE_URL" --clean --if-exists memory-2026-08-16.dump
```

Embeddings are ~3 KB per row, so dumps are dominated by vector columns. They
compress poorly. Facts and entities regenerate only by re-running extraction over
messages, which costs LLM calls, back up properly.

Nothing outside Postgres needs backing up. There is no local state on the API.

---

## Upgrading

```bash
git pull
npm ci
npm run build
# restart; migrations run on boot with MIGRATE_ON_START=true
```

Take a backup before upgrading, migrations are not reversible. See
[Migrations](/operations/migrations/).

---

## Cost

Gemini is the running cost. Per episode:

| | |
|---|---|
| LLM calls | 3, summary, extraction, contradiction judging |
| Embedding batches | 3, summary, entity names, fact strings |

Plus one embedding per `recall()` with a query, and one LLM call per
`recall({ include: ['synthesis'] })`.

**The biggest lever is `autoEpisodeIntervalMs`.** At the default of 10 seconds, a
conversation with natural pauses produces several episodes and pays that each
time. Raising it to 60 seconds or more is the single most effective change. See
[Tuning retrieval](/guides/tuning-retrieval/#autoepisodeintervalms-10000--the-cost-lever).

---

## Next

- [Database migrations](/operations/migrations/)
- [Background jobs](/operations/background-jobs/)
- [Privacy and data deletion](/operations/privacy-and-deletion/)

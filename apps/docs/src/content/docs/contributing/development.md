---
title: "Development setup"
description: "Node 20+ (22 recommended), PostgreSQL 14+ with pgvector, and a Gemini API key."
---
---

## Prerequisites

Node 20+ (22 recommended), PostgreSQL 14+ with `pgvector`, and a Gemini API key.

Full setup: [Installation](/getting-started/installation/).

```bash
git clone https://github.com/alagappan17/memory-soda
cd memory-soda
npm install

createdb memory_db
psql -d memory_db -c "CREATE ROLE memory_user LOGIN PASSWORD 'memory_pass';"
psql -d memory_db -c "CREATE EXTENSION IF NOT EXISTS vector;"
psql -d memory_db -c "ALTER DATABASE memory_db OWNER TO memory_user;"

cp .env.example .env      # fill in GOOGLE_GENERATIVE_AI_API_KEY
npm run dev
```

`npm run dev` runs the API (`:3004`) and dashboard (`:3000`) concurrently with
hot reload.

---

## Layout

```
apps/
  api/                    Express + Drizzle. The whole backend.
    drizzle/              SQL migrations + snapshots
    src/
      db/                 schema.ts, postgres.ts
      lib/                gemini.ts, semantic-extraction.ts, password.ts
      middleware/         auth.ts (API key), session.ts, validate.ts
      routes/             one router per resource — thin, HTTP only
      services/           the logic
      main.ts             wiring, first-boot seed, background jobs
  dashboard/              Vite + React 19 + React Router
packages/
  sdk/                    @alagappan17/memory-soda — published
  types/                  shared types, type-only at runtime
developer-docs/           this documentation
```

### Where logic lives

**Routes are thin.** Parse, validate with zod, call a service, map the result to
HTTP. No business logic.

**Services own everything else** — database access, LLM calls, transactions.
They throw plain errors; routes translate them to status codes.

**`packages/types` is type-only at runtime.** The API cannot import a runtime
value from it. That is why `ENTITY_TYPES` is duplicated as a `const` in
`semantic-extraction.ts` — the type union lives in `packages/types`, the runtime
allow-list has to be local.

---

## Commands

```bash
npm run dev              # API + dashboard, watch mode
npm run build            # everything
npm run typecheck        # all 5 projects
npm run test             # currently the api project only
npm run lint

npm run sdk:build        # build just the SDK

# from apps/api
npm run --workspace=apps/api db:generate   # create a migration from schema.ts
npm run --workspace=apps/api db:migrate    # apply pending migrations
npm run --workspace=apps/api db:studio     # schema/data browser
```

Nx caches aggressively. `--skip-nx-cache` forces a rerun when you suspect a stale
result.

---

## Working on the API

The dev server restarts on save. Watch its log — extraction happens in the
background and only surfaces there.

```bash
tail -f /tmp/api.log | grep -E '\[semantic\]|\[episodic\]|\[recall\]'
```

### Making extraction fast to iterate on

The default 10-second inactivity timer plus a 5-second tick makes each cycle slow.
Create test threads with a low override:

```ts
await memory.threads.create({
  dataset: 'dev_scratch',
  settings: { episodic: { autoEpisodeIntervalMs: 1000 } },
});
```

Or force it: `POST /v1/threads/:id/end`.

The [Playground](/dashboard/playground/) is the fastest loop — it shows every
call, polls for extraction, and displays the facts that came out.

### Inspecting state

```bash
psql "$DATABASE_URL"
```

```sql
-- pipeline health
SELECT status, semantic_status, count(*) FROM episodes GROUP BY 1,2;

-- what got extracted from an episode
SELECT subject, predicate, object, confidence, source_quote
FROM facts WHERE episode_id = '…';

-- reset a dataset without dropping the database
DELETE FROM threads  WHERE dataset = 'dev_scratch';
DELETE FROM facts    WHERE dataset = 'dev_scratch';
DELETE FROM entities WHERE dataset = 'dev_scratch';
DELETE FROM episodes WHERE dataset = 'dev_scratch';
```

Delete facts **before** episodes — `facts.episode_id` is `ON DELETE SET NULL`, so
the reverse order orphans them.

---

## Working on the SDK

The SDK is a thin typed wrapper over `fetch`. Adding a method means:

1. Add or update the type in `packages/types/src/lib/`.
2. Export it from `packages/sdk/src/index.ts`.
3. Add the method with a JSDoc block — the docs are generated from reading these.
4. Update [the SDK reference](/sdk/).

Testing against a local app:

```bash
npm run sdk:build
npm link --workspace=packages/sdk
# in your app
npm link @alagappan17/memory-soda
```

After changing SDK source, `npm run sdk:build` is enough — the link picks up the
new `dist`.

**Keep it dependency-free.** The SDK has zero runtime dependencies and that is
worth preserving.

---

## Working on the dashboard

```bash
npx nx dev dashboard
```

Vite on `:3000`, proxying nothing — it calls the API at `VITE_API_URL` directly,
so `CORS_ORIGIN` on the API must match.

UI components live in `apps/dashboard/src/components/ui/` — shadcn-style wrappers
over Base UI. **Check there before hand-rolling a component.** A dropdown, dialog,
select, tooltip, table and sheet all already exist.

> Base UI components have structural requirements. `DropdownMenuLabel` throws
> unless it is inside a `DropdownMenuGroup`, for instance. Read the component
> before using it.

---

## Conventions

**Comments explain why, not what.** The codebase is dense with rationale
comments on non-obvious decisions — why thinking is disabled on structured
calls, why relationships are demoted rather than dropped, why the correlated
subquery qualifies `threads.id`. Match that.

**Prefer deleting.** The surface is already larger than it should be.

**Match surrounding style.** No linter enforces most of it; read the neighbours.

---

## Gotchas

**Drizzle renders interpolated columns unqualified.** In a correlated subquery a
bare `"id"` binds to the *inner* table:

```ts
// wrong — "id" resolves to messages.id, so the predicate is never true
sql`(select count(*)::int from ${messages} where ${messages.threadId} = ${threads.id})`

// right
sql`(select count(*)::int from ${messages} where ${messages.threadId} = ${threads}."id")`
```

**Drizzle wraps driver errors.** The pg `code` is on `.cause`, not the thrown
error. Use `isUniqueViolation()` from `db/postgres.ts`.

**Zod strips unknown fields, it does not reject them.** A renamed field silently
loses data rather than returning 400.

**`db:push` desynchronises the migration journal.** Never run it against a
database you care about.

**The API will not boot without `GOOGLE_GENERATIVE_AI_API_KEY`.** The module
throws at import.

**Migrations that rename need writing by hand.** `drizzle-kit generate` prompts
interactively and cannot be automated. See
[Migrations](/operations/migrations/#when-generation-needs-a-decision).

---

## Before opening a PR

```bash
npm run typecheck
npm run build
npm run test
```

All three must pass. If you touched the extraction pipeline, retrieval or
compaction, exercise it end to end — typecheck will not catch a query that
returns the wrong rows. See [Testing](/contributing/testing/).

---

## Next

- [Testing](/contributing/testing/)
- [Architecture](/introduction/architecture/)
- [Migrations](/operations/migrations/)

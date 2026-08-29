# Contributing to Memory Soda

Thanks for taking the time. This file covers what you need to get a change
merged; the [docs site](https://github.com/alagappan17/memory-soda) covers how
the system works.

## Getting set up

Node 20+ and a PostgreSQL instance with the [pgvector](https://github.com/pgvector/pgvector)
extension available.

```bash
git clone https://github.com/alagappan17/memory-soda
cd memory-soda
npm install
cp .env.example .env      # fill in GOOGLE_GENERATIVE_AI_API_KEY and DATABASE_URL
npm run db:migrate
npm run dev               # API on :3004, dashboard on :3000
```

## Before you open a pull request

Run what CI runs:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

All four must pass. `npm run lint:fix` handles the mechanical fixes.

## What we look for

**No casts.** `as` is how a type error gets hidden instead of fixed. If you
need one, there is almost always a structural alternative — a `$type<T>()` on
the column, a schema-typed route handler, a narrowed request type. The four
places casts used to live in this codebase are documented in the git history
of the cleanup that removed them.

**Tests on the logic, not the plumbing.** Anything pure — retrieval fusion,
context rendering, extraction normalisation, settings merging — gets a test.
Database round-trips and LLM calls do not; keep new logic in `apps/api/src/lib`
where it can be tested without either. Tests are `node --test`, no framework.

**Comments explain why.** The codebase is deliberately heavy on comments that
record a decision or a hazard (why an index is partial, why a lock is held, why
thinking mode is disabled). It is deliberately light on comments that restate
the line below them.

**Migrations are additive and generated.** Edit `apps/api/src/db/schema.ts`,
then `npm run db:generate`. Never hand-edit a migration that has shipped. The
specialised indexes drizzle-kit cannot express (ivfflat, the full-text GIN
expression) are appended to the generated SQL by hand — if you touch one, keep
the expression identical to the query that must use it, or the planner will
quietly stop using the index.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/). The SDK release
process reads them to pick the next version.

```
feat(sdk): add memoryMiddleware for the Vercel AI SDK
fix(api): scope episode summarisation to the episode's own message window
```

## Project layout

| Path                          | What lives there                                                |
| ----------------------------- | --------------------------------------------------------------- |
| `apps/api`                    | Express API, Drizzle schema, the memory pipeline                |
| `apps/dashboard`              | Vite + React dashboard and playground                           |
| `apps/docs`                   | Astro Starlight documentation site                              |
| `packages/sdk`                | The published client, `@memory-soda/sdk`                        |
| `packages/types`              | Shared types and settings defaults — the single source of truth |
| `packages/create-memory-soda` | The `npm create memory-soda` installer                          |

## Reporting bugs

Include the API version, your Postgres version, and whether pgvector is
installed. For anything involving retrieval quality, the `recall()` response
with `include: ['raw']` is worth a thousand words.

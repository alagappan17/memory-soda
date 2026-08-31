# Memory Soda — agent guide

Memory layer for AI agents: working memory (threads/messages) → episodic
(summarised episodes) → semantic (bi-temporal facts + entities in Postgres/pgvector).
Read `CONTRIBUTING.md` for review standards; this file is the operational map.

## Layout

| Path                          | What                                                       | Notes                                  |
| ----------------------------- | ---------------------------------------------------------- | -------------------------------------- |
| `apps/api`                    | Express API + Drizzle schema + memory pipeline             | see `apps/api/CLAUDE.md`               |
| `apps/dashboard`              | Vite/React dashboard + playground                          | monochrome UI, talks to `/dashboard/*` |
| `apps/docs`                   | Astro Starlight docs, deployed to memorysoda.alagappan.dev | `nav.json` drives sidebar              |
| `packages/types`              | Zod schemas, TS types, project-setting defaults            | **single source of truth**             |
| `packages/sdk`                | `@memory-soda/sdk`, zero runtime deps                      | see `packages/sdk/CLAUDE.md`           |
| `packages/create-memory-soda` | `npm create memory-soda` installer                         | published separately                   |

## Commands

```bash
npm run dev            # api :3004 + dashboard :3000
npm run lint && npm run typecheck && npm test && npm run build   # what CI runs
npm run db:generate    # after editing apps/api/src/db/schema.ts
npm run db:migrate
npm run docs:build && npm run docs:check-links
npx nx test @memory-soda/api    # one project
```

Tests: `node --test`, no framework. Need a local Postgres **with pgvector**;
`TEST_DATABASE_URL` (default `postgresql://localhost:5432/postgres`) is only
used to CREATE/DROP one throwaway DB per test file. LLM calls are never made in
tests — keep logic in `apps/api/src/lib` so it is testable without DB or Gemini.

## Gotchas (learned the hard way)

- Source imports end in `.js`; tests run `.ts` directly via `tools/resolve-ts.mjs`.
  Node runs TS in strip-only mode: **no TS parameter properties, no enums**.
- `compactThread` returns the string sentinel `'NOT_FOUND'`, it does not throw.
- Test targets `dependsOn: ["^build"]` — a failing test after a types change is
  usually a stale build; run `npm run build` first.
- Drizzle can't express ivfflat / GIN expression indexes; they are hand-appended
  to generated SQL. Keep the GIN expression byte-identical to the query using it.
- `GEMINI_EMBED_DIM` is pinned to `vector(768)` columns; changing it is a migration
  plus a re-embed, not an env tweak.
- No API key is seeded on first boot; the dashboard creates keys.
- `apps/api/tsconfig.app.json` excludes `src/test`; the harness uses `import.meta`.

## Vocabulary and invariants

- `dataset`, never `userId` — the caller-chosen partition key for memory.
- `prepare()` = pure working memory (thread-scoped). `recall()` = thread-free
  long-term memory. `prepareAndRecall()` glues them. Don't blur the split.
- Bi-temporal facts: `validAt`/`validUntil` = when the fact was true in the world;
  `invalidAt` = when we stopped believing it. Contradictions set `invalidAt`,
  never delete. Same-day `validFrom` is coerced to "now".
- Facts about entities are anchored on the entity; facts about the user on `user`.
- Retrieval = vector + entity-anchor + full-text, fused by rank; thresholds live
  in project settings (`packages/types/src/lib/project-settings.ts`).
- Routes under `/v1` (API key) and `/dashboard/projects/:projectId/v1`
  (session) share one router.

## Docs example world

Docs use one consistent set of examples: car shopping (Toyota Corolla Hybrid vs
SUVs, typo "corola hybrid"), Honda Civic → Tesla Model 3 for bi-temporal
changes, Netflix / Breaking Bad for anchor retrieval, sci-fi vs horror for
preferences. Reuse them; don't introduce new domains.

## Working rules

- Never commit or push unless explicitly asked for that batch.
- No `as` casts. Comments explain _why_, not _what_.
- Any public change (route, SDK method, setting, env var) updates the docs in the
  same change — use the `docs-sync` skill.
- Few-shot examples inside Gemini prompts (`apps/api/src/lib/semantic-extraction.ts`,
  `gemini.ts`) are behaviour-sensitive. Don't edit them casually; run the
  `eval-extraction` skill before and after.

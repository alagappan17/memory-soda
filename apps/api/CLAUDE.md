# apps/api

Express + Drizzle. `main.ts` boots, `app.ts` builds the Express app (kept
separate so tests can import it), `worker.ts` runs background jobs.

## Where things go

| Concern | Path |
|---|---|
| Route handlers (thin: validate → service → respond) | `src/routes/{memory,admin}/*.ts`, `auth.ts`, `health.ts` |
| Business logic + DB access | `src/services/*.service.ts` |
| Pure, unit-tested logic (no DB, no LLM) | `src/lib/*.ts` with sibling `*.test.ts` |
| Gemini calls (generate, structured, embed) | `src/lib/gemini.ts` |
| Extraction prompt + contradiction judge | `src/lib/semantic-extraction.ts` |
| Schema | `src/db/schema.ts` → `drizzle/*.sql` via `npm run db:generate` |
| Auth guards | `src/middleware/authenticate.ts` (API key vs session), `project-scope.ts` |
| Integration tests | `src/test/*.test.ts`, `harness.ts` (`startApi(name)` → real DB per file) |

## Conventions

- Use `projectRoute` / `Responded` from `src/lib/route.ts` for every handler;
  the project comes from `res.locals`, never from the request body.
- Request/response shapes are Zod schemas in `packages/types`; import them,
  don't redeclare.
- Errors: throw `AppError.*` from `src/lib/errors.ts`; the error middleware
  maps them. Zod issues become `400 { error: 'Validation error', issues }`.
- Semantic pipeline: `processSemanticMemory(episodeId)` = extract → resolve
  entities → dedup → evolve (contradictions) → write. Claims the episode row
  atomically; stale `processing` rows are reclaimed after `STALE_PROCESSING_MS`.
- Settings are merged per project: `getEffectiveSemanticSettings` over the
  defaults in `packages/types`. Add a new knob there first.
- `NODE_ENV=test` skips real Gemini calls; anything that must hit Gemini is not
  integration-testable — put its pure parts in `src/lib`.

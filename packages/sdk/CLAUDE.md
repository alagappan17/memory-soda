# packages/sdk — @memory-soda/sdk

Published client. Zero runtime dependencies (global `fetch`, `AbortSignal.timeout`,
Node ≥18). Built by `tsup` to ESM + CJS + d.ts; `@memory-soda/types` is bundled
into the declarations, never a runtime dep.

## Rules

- **Flat API.** Methods live on `MemorySoda` directly (`client.listFacts`), no
  nested namespaces. Decided; don't reopen.
- Every method: one HTTP call via `src/http.ts`, typed with schemas from
  `packages/types`, and a unit test in `client.test.ts` using the fake transport.
- Public surface is exactly what `src/index.ts` exports. Adding an export is a
  minor bump; removing/renaming one is breaking.
- Errors: `ApiError` (4xx/5xx with body), `AuthError` (401/403), `NetworkError`.
- `src/ai/*` is the optional Vercel AI SDK integration (`memoryTool`,
  `memoryMiddleware`, message helpers), exported from `./ai`. Keep it free of
  hard deps on the `ai` package at runtime — types only.
- After any change here: update `apps/docs/src/content/docs/sdk/*.md` and
  `packages/sdk/README.md`; run `npm run sdk:build && cd packages/sdk && npm pack --dry-run`
  and confirm only `dist/` + `README.md` ship.

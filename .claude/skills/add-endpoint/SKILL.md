---
name: add-endpoint
description: Add or change a Memory Soda API endpoint end-to-end (types → route → service → SDK → docs → test). Use whenever a request touches the public HTTP or SDK surface.
---

# Add / change an endpoint

The API, SDK and docs drift when only one is edited. Walk every step; skip
none silently — say which you skipped and why.

1. **Types first** — `packages/types/src/lib/<area>.ts`: Zod request/response
   schemas + inferred types, exported from `packages/types/src/index.ts`.
2. **Service** — `apps/api/src/services/<area>.service.ts`. Pure helpers go in
   `apps/api/src/lib/` with a `*.test.ts`.
3. **Route** — `apps/api/src/routes/memory/<area>.ts` (or `admin/`). Use
   `projectRoute` from `lib/route.ts`; validate with the schema from step 1;
   throw `AppError.*` for failures. Memory routes are auto-mounted at both
   `/v1` and `/dashboard/projects/:projectId/v1`.
4. **SDK** — `packages/sdk/src/client.ts`: one flat method, JSDoc, re-export any
   new types from `src/index.ts`. Add a case to `client.test.ts`.
5. **Integration test** — `apps/api/src/test/memory.test.ts` (or `admin.test.ts`)
   using `startApi()`; cover the happy path and the 400/404 branch.
6. **Docs** — run the `docs-sync` skill: `apps/docs/.../api/<area>.md`,
   `sdk/<area>.md`, `sdk/types.md`, and `reference/errors.md` if a new error.
   Use the shared example world (cars / Netflix / sci-fi).
7. **Verify** — `npm run build && npm run typecheck && npm test && npm run docs:build`.

Checklist before reporting done:

- [ ] new schema exported from `packages/types`
- [ ] route reachable via `/v1` with an API key
- [ ] SDK method + unit test
- [ ] integration test
- [ ] API doc, SDK doc, types doc updated

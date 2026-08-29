---
name: docs-sync
description: Keep apps/docs, READMEs and SDK docs in step with code after any public change (route, SDK method, setting, env var, error, schema). Use at the end of every feature or when asked to update docs.
---

# Docs sync

Docs live in `apps/docs/src/content/docs`. Sidebar order is `apps/docs/nav.json`.

## Code → doc map

| Changed | Update |
|---|---|
| `apps/api/src/routes/**` | `api/<area>.md` (request, response, errors) |
| `packages/sdk/src/client.ts` | `sdk/<area>.md`, `sdk/client.md`, `packages/sdk/README.md` |
| `packages/types/src/**` | `sdk/types.md` |
| `packages/types/.../project-settings.ts` | `reference/project-settings.md`, `dashboard/project-settings.md` |
| `apps/api/src/config.ts` / `.env.example` | `reference/environment-variables.md`, `getting-started/configuration.md` |
| `apps/api/src/lib/errors.ts` | `reference/errors.md`, `sdk/errors.md` |
| `apps/api/src/db/schema.ts` | `reference/database-schema.md` |
| Retrieval / extraction behaviour | `concepts/*.md`, `guides/tuning-retrieval.md`, `introduction/how-it-works.md` |
| Limits, timeouts, constants | `reference/limits.md` |
| Install / first boot | `getting-started/*.md`, root `README.md`, `packages/create-memory-soda/README.md` |

## Rules

- One example world everywhere: car shopping (Toyota Corolla Hybrid vs SUVs,
  typo "corola hybrid" → canonical), Honda Civic → Tesla Model 3 for
  bi-temporal change, "anything on Netflix" → "favourite show is breaking bad"
  for anchor retrieval, sci-fi vs horror for preferences, `user_42` dataset.
  Don't invent a new domain; extend these.
- Show real shapes: copy the actual Zod schema fields, don't paraphrase.
- Keep ASCII diagrams (D2 was tried and reverted).
- Frontmatter `description` is required and shown in listings.

## Verify

```bash
npm run docs:build && npm run docs:check-links
grep -rn -iE 'camera|osmo|berlin|lisbon|thailand|mango|vegetarian' apps/docs/src README.md packages/*/README.md   # must be empty
```

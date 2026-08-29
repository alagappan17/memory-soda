---
name: db-migration
description: Change the Postgres schema safely with Drizzle (edit schema.ts → generate → review SQL → migrate → update schema docs). Use for any column, table, index or enum change.
---

# Database migration

1. Edit `apps/api/src/db/schema.ts` only. Use `$type<T>()` instead of casts.
2. `npm run db:generate` → new `apps/api/drizzle/NNNN_<name>.sql` + journal entry.
3. **Read the generated SQL.** Confirm it is additive. Never edit a migration
   that has shipped (anything already on `main`); add a new one instead.
4. Indexes Drizzle cannot express — ivfflat on `vector(768)` columns, the
   full-text GIN over an expression — must be appended by hand to the new SQL.
   The GIN expression must match the query in
   `apps/api/src/services/semantic-memory.service.ts` character for character
   or the planner silently stops using it. Grep for the existing expression and
   copy it.
5. `npm run db:migrate` locally, then `npm test` (the harness runs every
   migration from scratch on a fresh DB, so a broken journal fails here).
6. Update `apps/docs/src/content/docs/reference/database-schema.md` and, if a
   project setting changed, `reference/project-settings.md` +
   `packages/types/src/lib/project-settings.ts` defaults.

Hazards seen before:
- Journal drift: a migration file without a `_journal.json` entry (or vice
  versa) makes `migrate` skip or double-apply. Check
  `jq '.entries[] | {idx, tag}' apps/api/drizzle/meta/_journal.json`.
- `CREATE EXTENSION vector` needs a superuser; the test harness does it out of
  band. Don't rely on the migration for it in prod docs either.
- Renaming a column generates DROP + ADD. Use `.renameTo` semantics manually if
  data must survive (see `0007_dataset_rename.sql` for the pattern).
- Embedding dimension is pinned; changing `GEMINI_EMBED_DIM` requires a
  migration plus a re-embed job, not just the env var.

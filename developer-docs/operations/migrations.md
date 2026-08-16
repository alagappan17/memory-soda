# Database migrations

Drizzle Kit, with plain SQL files checked into the repo.

```
apps/api/drizzle/
├── 0000_init.sql
├── 0001_broad_william_stryker.sql
├── …
├── 0010_tokens_rename.sql
└── meta/
    ├── _journal.json          the ordered list of applied migrations
    └── NNNN_snapshot.json     schema state after each one
```

---

## Applying

### On boot (default)

```bash
MIGRATE_ON_START=true
```

Pending migrations run before the HTTP listener opens. Convenient, and the right
default for single-instance deployments.

> With multiple replicas starting simultaneously, they will race. Drizzle takes a
> lock, so the outcome is safe, but startup is slower. For a fleet, set
> `MIGRATE_ON_START=false` and run migrations as a separate step.

### Explicitly

```bash
npm run --workspace=apps/api db:migrate
```

Reads `DATABASE_URL` from the environment. Idempotent — already-applied
migrations are skipped.

### As a deploy step

```bash
MIGRATE_ON_START=false
npm run --workspace=apps/api db:migrate   # once, before rolling out
# then start instances
```

---

## Prerequisite

The `vector` extension must exist **before** the first migration:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Superuser, once per database. Migrations do not create it.

---

## Checking state

```sql
SELECT * FROM drizzle.__drizzle_migrations ORDER BY created_at;
```

Against the journal:

```bash
cat apps/api/drizzle/meta/_journal.json | jq '.entries[] | {idx, tag}'
```

---

## Writing one

### Normal case

Edit `apps/api/src/db/schema.ts`, then:

```bash
npm run --workspace=apps/api db:generate
```

Drizzle diffs the schema against the latest snapshot, writes a new SQL file, a
snapshot, and a journal entry.

**Review the generated SQL before committing.** Drizzle occasionally generates a
drop-and-recreate where an `ALTER` was intended.

### When generation needs a decision

`drizzle-kit generate` prompts interactively when a change is ambiguous — a
renamed column looks identical to a drop plus an add. It cannot be answered
non-interactively.

For renames, write the migration by hand:

```sql
-- 0010_tokens_rename.sql
ALTER TABLE "threads" DROP COLUMN "message_count";--> statement-breakpoint
ALTER TABLE "messages" RENAME COLUMN "token_count" TO "tokens";
```

Then create the snapshot and journal entry manually, and verify:

```bash
npm run --workspace=apps/api db:generate
# should report "No schema changes, nothing to migrate"
```

That check is the important part — it proves the snapshot matches the schema.

### Statement separator

Multiple statements in one file must be separated by:

```sql
--> statement-breakpoint
```

Without it Drizzle sends the file as a single statement and Postgres rejects it.

---

## Indexes Drizzle cannot generate

The pgvector and full-text indexes are **hand-written** in migration SQL, because
`drizzle-kit` does not emit them from the `vector` custom type or from an
expression index.

```sql
CREATE INDEX "facts_embedding_idx"    ON "facts"    USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100) WHERE "embedding" IS NOT NULL;
CREATE INDEX "entities_embedding_idx" ON "entities" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100) WHERE "embedding" IS NOT NULL;
CREATE INDEX "episodes_embedding_idx" ON "episodes" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100) WHERE "embedding" IS NOT NULL;

CREATE INDEX "facts_tsv_idx" ON "facts" USING gin (
  to_tsvector('english',
    coalesce("subject",'') || ' ' || coalesce("predicate",'') || ' ' || coalesce("object",''))
);
```

> **The `facts_tsv_idx` expression must stay byte-identical to the expression the
> query builds.** If they drift, the planner silently stops using the index and
> keyword retrieval falls back to a sequential scan. If you touch the fields in
> the tsvector, change both.

### A note on the IVFFlat indexes

They were created on **empty tables**. IVFFlat builds its centroids at creation
time, so an index built on zero rows has degenerate clusters and does not improve
as data arrives.

If vector recall seems poor on a populated instance:

```sql
REINDEX INDEX CONCURRENTLY facts_embedding_idx;
SET ivfflat.probes = 10;   -- default is 1; higher = better recall, slower
```

Or switch to HNSW, which does not depend on data at build time and handles
filtered queries better:

```sql
DROP INDEX facts_embedding_idx;
CREATE INDEX facts_embedding_idx ON facts
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
```

---

## Rollback

**There is none.** Drizzle does not generate down migrations, and none are
written by hand.

To undo:

1. Restore from backup, or
2. Write a new forward migration that reverses the change.

**Take a backup before upgrading:**

```bash
pg_dump "$DATABASE_URL" --format=custom --file=pre-migrate-$(date +%F).dump
```

---

## Migration history

| # | Tag | Change |
|---|---|---|
| 0000 | `init` | Projects, API keys, threads, messages, episodes; pgvector indexes |
| 0001 | `broad_william_stryker` | `scheduled_episodes` |
| 0002 | `fast_firestar` | `facts` and `entities`; their vector and GIN indexes |
| 0003 | `short_metal_master` | Semantic refinements |
| 0004 | `flowery_owl` | Object and recency indexes on `facts` |
| 0005 | `left_mad_thinker` | tsvector index rework |
| 0006 | `fine_sue_storm` | tsvector expression narrowed to subject/predicate/object |
| 0007 | `dataset_rename` | `user_id` → `dataset` across all tables |
| 0008 | `confidence_retrieval` | `facts.confidence` |
| 0009 | `brown_lilandra` | `users` and `sessions` for dashboard auth |
| 0010 | `tokens_rename` | Dropped `threads.message_count`; `messages.token_count` → `tokens` |

---

## Other commands

```bash
npm run --workspace=apps/api db:studio   # Drizzle Studio, a schema/data browser
npm run --workspace=apps/api db:push     # push schema without a migration file
```

> **Never use `db:push` against a database you care about.** It reconciles the
> schema directly with no migration record, which desynchronises the journal from
> reality. Development scratch databases only.

---

## Troubleshooting

**`extension "vector" is not available`** — pgvector is not installed for your
Postgres *major version*.

**`permission denied for schema public`** — the role in `DATABASE_URL` must own
the database: `ALTER DATABASE memory_db OWNER TO memory_user;`

**`relation already exists`** — the journal and the database disagree, usually
after a `db:push`. Reconcile `drizzle.__drizzle_migrations` by hand or restore
from backup.

**Migration hangs** — another connection holds a conflicting lock. Check
`pg_stat_activity` for idle-in-transaction sessions.

---

## Next

- [Database schema](../reference/database-schema.md) — the resulting tables
- [Self-hosting](./self-hosting.md)

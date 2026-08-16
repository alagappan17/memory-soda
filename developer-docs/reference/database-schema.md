# Database schema

Nine tables in PostgreSQL with `pgvector`. Defined in
`apps/api/src/db/schema.ts`, applied by [migrations](../operations/migrations.md).

```
projects ──┬── api_keys
           │
           ├── threads ──── messages
           │      │
           │      └──── episodes ──── facts
           │
           ├── scheduled_episodes
           │
           └── entities          (referenced by name, not FK)

users ──── sessions              (dashboard login only)
```

**Tenancy** is `(project_id, dataset)` on every memory table.

---

## `projects`

```sql
id           uuid PRIMARY KEY DEFAULT gen_random_uuid()
name         text NOT NULL
description  text
settings     jsonb                    -- partial ProjectSettings, merged with defaults
created_at   timestamp NOT NULL DEFAULT now()
```

`settings` stores **only what was overridden**, so new defaults in a future
version reach projects that never changed them.

---

## `api_keys`

```sql
id           uuid PRIMARY KEY
name         text NOT NULL
key          text NOT NULL UNIQUE     -- SHA-256 hash, never plaintext
key_preview  text NOT NULL            -- "ms_3f9a4c…0161"
project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE
created_at   timestamp NOT NULL DEFAULT now()
last_used_at timestamp
revoked_at   timestamp
```

`last_used_at` is written on **every authenticated request** — one UPDATE per
API call.

---

## `users` / `sessions`

Dashboard operators. Not end-user data.

```sql
-- users
id             uuid PRIMARY KEY
username       text NOT NULL UNIQUE
password_hash  text NOT NULL          -- scrypt$N$r$p$salt$hex (legacy: salt:hex)
created_at     timestamptz NOT NULL DEFAULT now()
updated_at     timestamptz NOT NULL DEFAULT now()

-- sessions
id           uuid PRIMARY KEY
user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE
token        text NOT NULL UNIQUE     -- SHA-256 hash
created_at   timestamptz NOT NULL DEFAULT now()
expires_at   timestamptz NOT NULL     -- created_at + 7 days
last_used_at timestamptz
revoked_at   timestamptz

INDEX sessions_user_idx (user_id)
```

---

## `threads`

```sql
id                       uuid PRIMARY KEY
dataset                  text NOT NULL
project_id               uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE
tags                     text[] NOT NULL DEFAULT '{}'
metadata                 jsonb
created_at               timestamptz NOT NULL DEFAULT now()
updated_at               timestamptz NOT NULL DEFAULT now()
last_activity_at         timestamptz NOT NULL DEFAULT now()
auto_compact_threshold   integer                  -- NULL disables compaction
episodic_settings        jsonb                    -- per-thread override
semantic_settings        jsonb                    -- supported internally, no API
last_compacted_at        timestamptz
last_compacted_sequence  integer NOT NULL DEFAULT 0

INDEX threads_activity_idx (last_activity_at)
INDEX threads_project_idx  (project_id)
```

> There is **no `message_count`**. It was a denormalised counter that could drift
> and was dropped in migration 0010; counts are derived with a correlated
> subquery.

---

## `messages`

```sql
id               uuid PRIMARY KEY
thread_id        uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE
role             message_role NOT NULL       -- user | assistant | system | tool
content          text NOT NULL
sequence_number  integer NOT NULL
tokens           jsonb                       -- { input?, output?, total? }
model            text
latency_ms       integer
metadata         jsonb                       -- { stopReason?, agentName? }
compacted_at     timestamptz                 -- set when folded into a summary
created_at       timestamptz NOT NULL DEFAULT now()

UNIQUE INDEX messages_thread_seq_idx      (thread_id, sequence_number)
INDEX        messages_thread_time_idx     (thread_id, created_at DESC)
INDEX        messages_thread_compacted_idx(thread_id, compacted_at)
```

`sequence_number` is assigned inside a `FOR UPDATE` transaction on the thread
row. It is the pagination cursor and the compaction watermark.

Summary rows carry `metadata.type = 'compact_summary'` with a `compactedRange`.

> The column was renamed from `token_count` to `tokens` in migration 0010.

---

## `episodes`

```sql
id                        uuid PRIMARY KEY
thread_id                 uuid REFERENCES threads(id)
dataset                   text NOT NULL
project_id                uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE
status                    episode_status  NOT NULL DEFAULT 'pending'
semantic_status           semantic_status NOT NULL DEFAULT 'pending'
summary                   text
key_learnings             jsonb                     -- string[]
embedding                 vector(768)
message_count             integer NOT NULL DEFAULT 0
token_count               integer
started_at                timestamptz
ended_at                  timestamptz
processing_started_at     timestamptz
processing_completed_at   timestamptz
error                     text
retry_count               integer NOT NULL DEFAULT 0
semantic_retry_count      integer NOT NULL DEFAULT 0
start_sequence            integer                   -- inclusive message window
end_sequence              integer
metadata                  jsonb
created_at                timestamptz NOT NULL DEFAULT now()
updated_at                timestamptz NOT NULL DEFAULT now()

INDEX episodes_dataset_project_status_idx (dataset, project_id, status)
INDEX episodes_dataset_created_idx        (dataset, created_at)
INDEX episodes_thread_idx                 (thread_id)
INDEX episodes_status_created_idx         (status, created_at)
INDEX episodes_embedding_idx              ivfflat (embedding vector_cosine_ops) WITH (lists=100)
                                          WHERE embedding IS NOT NULL
```

**Two independent status columns.**

```sql
episode_status  : pending | processing | completed | failed | deleted | archived
semantic_status : pending | processing | completed | failed | skipped
```

`status` tracks summarisation; `semantic_status` drives fact extraction.
`semantic_status` is **not exposed on any endpoint** — query it directly.

`[start_sequence, end_sequence]` is the message window extraction reads. `NULL`
on legacy rows, which fall back to the whole un-compacted thread.

---

## `scheduled_episodes`

A one-row-per-thread timer.

```sql
thread_id  uuid PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE
project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE
fire_at    timestamptz NOT NULL

INDEX scheduled_episodes_fire_at_idx (fire_at)
```

`addMessage` upserts `fire_at = now() + autoEpisodeIntervalMs`. Because the
primary key is `thread_id`, a burst of messages keeps pushing the deadline out
rather than queuing many episodes.

Claimed with `DELETE … RETURNING`, so each row fires exactly once.

---

## `facts`

The core table.

```sql
id               uuid PRIMARY KEY
dataset          text NOT NULL
project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE
subject          text NOT NULL              -- always 'user'
predicate        text NOT NULL
object           text NOT NULL
object_is_entity boolean NOT NULL DEFAULT false
confidence       real NOT NULL DEFAULT 1    -- model self-rated, 0–1
source_quote     text                       -- verbatim provenance
episode_id       uuid REFERENCES episodes(id) ON DELETE SET NULL
valid_at         timestamptz NOT NULL DEFAULT now()   -- valid time
valid_until      timestamptz                          -- valid time
invalid_at       timestamptz                          -- belief time
embedding        vector(768)
created_at       timestamptz NOT NULL DEFAULT now()   -- belief time
updated_at       timestamptz NOT NULL DEFAULT now()
```

One table holds both literal facts (`object_is_entity = false`) and entity
relationships (`true`), which leaves multi-hop traversal possible later without a
second store.

### Indexes

```sql
INDEX facts_dataset_project_invalid_idx (dataset, project_id, invalid_at)
INDEX facts_dataset_project_subject_idx (dataset, project_id, subject)
INDEX facts_dataset_project_object_idx  (dataset, project_id, object)
INDEX facts_episode_idx                 (episode_id)

-- no-query fallback
INDEX facts_dataset_project_recency_idx (dataset, project_id, valid_at)
      WHERE invalid_at IS NULL

-- duplicate backstop across concurrent extraction jobs
UNIQUE INDEX facts_live_exact_idx
      (dataset, project_id, subject, predicate, object,
       coalesce(valid_until, 'infinity'::timestamptz))
      WHERE invalid_at IS NULL

INDEX facts_embedding_idx ivfflat (embedding vector_cosine_ops) WITH (lists=100)
      WHERE embedding IS NOT NULL

INDEX facts_tsv_idx gin (
  to_tsvector('english',
    coalesce(subject,'') || ' ' || coalesce(predicate,'') || ' ' || coalesce(object,''))
)
```

`valid_until` is part of the unique key so an expired fact does not block
re-asserting the same claim.

> `facts_tsv_idx`'s expression must stay **byte-identical** to the one the query
> builds, or the planner silently stops using it.

### Liveness

```sql
invalid_at IS NULL
AND valid_at <= now()
AND (valid_until IS NULL OR valid_until > now())
```

`now()` is not immutable, so the `valid_until` clause cannot be pushed into the
partial indexes — they are keyed on `invalid_at IS NULL` and cover a superset of
live rows.

Point-in-time:

```sql
created_at   <= $asOf
AND valid_at <= $asOf
AND (valid_until IS NULL OR valid_until > $asOf)
AND (invalid_at  IS NULL OR invalid_at  > $asOf)
```

See [The bi-temporal model](../concepts/bi-temporal-model.md).

---

## `entities`

```sql
id         uuid PRIMARY KEY
dataset    text NOT NULL
project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE
name       text NOT NULL              -- lower-cased canonical form
type       text NOT NULL              -- PERSON | ORG | PLACE | …
embedding  vector(768)
created_at timestamptz NOT NULL DEFAULT now()
updated_at timestamptz NOT NULL DEFAULT now()

UNIQUE INDEX entities_dataset_project_name_idx (dataset, project_id, name)
INDEX entities_embedding_idx ivfflat (embedding vector_cosine_ops) WITH (lists=100)
      WHERE embedding IS NOT NULL
```

**Facts reference entities by name, not by foreign key.** Deliberate: it keeps
the write path free of lookups and makes the anchor query a plain `IN (…)`.
The cost is no referential integrity — a renamed entity would orphan its facts,
which is why entity names are never updated in place.

---

## Vector storage

- pgvector, **768 dimensions**, from `gemini-embedding-001`.
- Cosine distance (`<=>`); similarity is `1 - distance`.
- ~3 KB per embedding. They dominate database size and compress poorly.

> The IVFFlat indexes were created on empty tables, so their centroids are
> degenerate. On a populated instance, `REINDEX` or switch to HNSW —
> see [Migrations](../operations/migrations.md#a-note-on-the-ivfflat-indexes).

---

## Cascade behaviour

| Deleting | Removes |
|---|---|
| `projects` | api_keys, threads → messages, episodes, facts, entities, scheduled_episodes |
| `threads` | messages, scheduled_episodes. **Not episodes** (nullable FK), **not facts** |
| `episodes` | Nothing — `facts.episode_id` is `ON DELETE SET NULL` |
| `users` | sessions |

Facts and entities are scoped to the **dataset**, not the thread, and outlive
both. Deleting a conversation does not delete what was learned from it. See
[Privacy and data deletion](../operations/privacy-and-deletion.md).

---

## Useful queries

```sql
-- rows per table for a dataset
SELECT 'threads' t, count(*) FROM threads  WHERE dataset='user_42'
UNION ALL SELECT 'facts',    count(*) FROM facts    WHERE dataset='user_42'
UNION ALL SELECT 'entities', count(*) FROM entities WHERE dataset='user_42'
UNION ALL SELECT 'episodes', count(*) FROM episodes WHERE dataset='user_42';

-- live facts
SELECT subject, predicate, object, valid_at
FROM facts
WHERE dataset='user_42'
  AND invalid_at IS NULL
  AND valid_at <= now()
  AND (valid_until IS NULL OR valid_until > now())
ORDER BY valid_at DESC;

-- pipeline health
SELECT status, semantic_status, count(*) FROM episodes GROUP BY 1,2 ORDER BY 3 DESC;

-- largest datasets, for the extraction memory ceiling
SELECT dataset, count(*) AS live_facts
FROM facts WHERE invalid_at IS NULL
GROUP BY 1 ORDER BY 2 DESC LIMIT 20;

-- table sizes
SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS size
FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC;
```

---

## Next

- [Migrations](../operations/migrations.md)
- [The bi-temporal model](../concepts/bi-temporal-model.md)
- [Limits and defaults](./limits.md)

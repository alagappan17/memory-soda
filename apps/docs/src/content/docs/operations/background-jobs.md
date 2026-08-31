---
title: 'Background jobs'
description: 'One clock in the API process drives everything asynchronous. There is no queue and no separate worker.'
---

One clock in the API process drives everything asynchronous. There is no queue
and no separate worker: a single `setInterval(...).unref()` ticks every 5
seconds, and each job runs every Nth tick rather than on its own timer, one
`processScheduledEpisodes` call gets a slow sweep out of the way before the
next tick starts, instead of two independent intervals racing each other.

## The jobs

| Effective interval          | Job                        | Does                                                                        |
| --------------------------- | -------------------------- | --------------------------------------------------------------------------- |
| **5 s** (every tick)        | `processScheduledEpisodes` | Drains due rows from `scheduled_episodes`; creates and processes episodes   |
| **120 s** (every 24th tick) | `retryFailedEpisodes`      | Retries up to 20 failed episodes, bounded by `maxRetries`                   |
| **120 s** (every 24th tick) | `sweepSemanticMemory`      | Picks up episodes whose fact extraction is pending, failed or orphaned      |
| **1 h** (every 720th tick)  | `sweepAbandonedThreads`    | Opens episodes for threads quiet 24 h with uncaptured messages and no timer |

A tick that overruns delays the next one rather than stacking a second copy on
top of it.

## `processScheduledEpisodes` (5 s)

The main path from conversation to memory.

Every `addMessage` upserts a row into `scheduled_episodes` with
`fireAt = now + autoEpisodeIntervalMs` (default 30 minutes). Because it is an
upsert, a burst of messages keeps pushing the deadline out, extraction fires
when the conversation goes quiet, not once per message. Creating a new thread in
the same dataset pulls every sibling's `fire_at` forward to at most 5 minutes
out (`LEAST(fire_at, now() + 5 min)`), so a user starting a fresh chat closes
the old one without waiting out the interval.

The job claims due rows atomically:

```sql
DELETE FROM scheduled_episodes
WHERE thread_id IN (SELECT thread_id FROM scheduled_episodes WHERE fire_at < now() LIMIT 20)
RETURNING thread_id, project_id;
```

`DELETE … RETURNING` means a row is claimed exactly once even with concurrent
workers. Up to 20 threads per tick.

For each, it creates a `pending` episode and starts processing. Episodes are
skipped when episodic memory is disabled or `autoEpisodeIntervalMs` is `null`.

## `sweepAbandonedThreads` (1 h)

The backstop for the timer. A thread whose `last_activity_at` is over 24 hours
old, that has messages past its last episode's `end_sequence`, and that has no
`scheduled_episodes` row gets an episode opened. The only way to reach that
state is a crash between claiming the timer row and writing the pending
episode, so the sweep is normally a no-op. Same `enabled` / `null` interval
contract as the timer. Up to 20 threads per run.

## `retryFailedEpisodes` (120 s)

Reads up to 20 `failed` episodes and retries those under `maxRetries` (default 3).

The claim is compare-and-set on `retryCount`, so two workers cannot both bump it:

```sql
UPDATE episodes SET retry_count = $old + 1, error = NULL
WHERE id = $id AND status = 'failed' AND retry_count = $old
RETURNING id;
```

Episodes past the cap are left alone permanently.
[`POST …/episodes/:id/retry`](/api/episodic-memory/) shares this same cap
check, so it cannot push one past it either, it only lets you retry sooner
than the next sweep. To force one past the cap, reset `retry_count` in SQL.

## `sweepSemanticMemory` (120 s)

The backstop for fact extraction. Normally `processEpisode` fires
`processSemanticMemory` directly on completion; if that trigger is missed, a
crash between the two, a restart, a migration reset, this catches it.

Picks up to 20 episodes that are `completed` or `archived` **and** whose
`semanticStatus` is:

- `pending`, the trigger never ran
- `failed`, under `MAX_SEMANTIC_RETRIES` (3)
- `processing` **and older than 10 minutes**, orphaned by a dead worker

> `archived` is included deliberately. An episode can be archived by the next
> episode on its thread before its semantic pass ran; without this its message
> window would never be extracted.

Processed **sequentially**, because each fans out LLM and embedding calls. One
large dataset therefore stalls the queue behind it.

## Claiming and crash safety

Every claim is a conditional `UPDATE … RETURNING`:

```sql
UPDATE episodes SET semantic_status = 'processing', updated_at = now()
WHERE id = $id
  AND (semantic_status IN ('pending','failed')
       OR (semantic_status = 'processing' AND updated_at < now() - interval '10 minutes'))
RETURNING *;
```

Returns zero rows if another worker got there first. Combined with the 10-minute
staleness window, a worker that dies mid-extraction releases its claim
automatically.

Fact writes are additionally serialised per tenant:

```sql
SELECT pg_advisory_xact_lock(hashtext('<dataset>:<projectId>'));
```

so two concurrent extraction jobs for the same dataset cannot interleave their
invalidate-and-insert.

## Single instance

> **Run one API process.**

Nothing coordinates the clock across replicas, no leader election, no
distributed lock around the ticks. Atomic claims mean duplicates do not corrupt
data, but N replicas do N times the polling for no benefit.

If you need more than one:

```ts
// wrap each tick
const [{ locked }] = await db.execute(
  sql`SELECT pg_try_advisory_lock(hashtext('memory-soda:scheduled-episodes')) AS locked`,
);
if (locked) {
  try {
    await processScheduledEpisodes();
  } finally {
    await db.execute(
      sql`SELECT pg_advisory_unlock(hashtext('memory-soda:scheduled-episodes'))`,
    );
  }
}
```

Roughly four lines per job.

## Monitoring

Nothing is surfaced in the UI, and `/health` only checks Postgres. Watch these in
SQL.

### Backlog

```sql
SELECT count(*) AS due
FROM scheduled_episodes
WHERE fire_at < now();
```

Should be near zero. A persistent backlog means episodes take longer to process
than they arrive.

### Failures

```sql
SELECT status, semantic_status, count(*)
FROM episodes
GROUP BY 1, 2
ORDER BY 3 DESC;
```

Healthy looks like almost everything `completed / completed`.

### Stuck work

```sql
SELECT id, dataset, semantic_status, semantic_retry_count, error, updated_at
FROM episodes
WHERE semantic_status = 'processing'
  AND updated_at < now() - interval '10 minutes';
```

Rows here should be picked up by the next sweep. If they persist, the sweep is
not running.

### Given up

```sql
SELECT id, dataset, retry_count, semantic_retry_count, left(error, 120) AS err
FROM episodes
WHERE retry_count >= 3 OR semantic_retry_count >= 3
ORDER BY updated_at DESC;
```

These will never be retried automatically.

### Extraction latency

```sql
SELECT
  percentile_cont(0.5) WITHIN GROUP (ORDER BY processing_completed_at - created_at) AS p50,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY processing_completed_at - created_at) AS p95
FROM episodes
WHERE processing_completed_at IS NOT NULL
  AND created_at > now() - interval '1 day';
```

### A suggested alert

```sql
SELECT
  (SELECT count(*) FROM scheduled_episodes WHERE fire_at < now() - interval '5 minutes') AS stale_backlog,
  (SELECT count(*) FROM episodes WHERE status = 'failed' AND updated_at > now() - interval '1 hour') AS recent_failures,
  (SELECT count(*) FROM episodes WHERE semantic_status = 'failed' AND updated_at > now() - interval '1 hour') AS recent_semantic_failures;
```

Alert on any of them being non-trivially above zero.

## Failure modes

| Symptom                                              | Likely cause                                                          |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| Backlog grows, no failures                           | Gemini is slow or rate-limiting; sequential sweep cannot keep up      |
| Everything `failed` with a Gemini error              | Bad or exhausted API key                                              |
| `semantic_status = 'failed'`, `status = 'completed'` | Extraction or contradiction judging failing; check `error`            |
| Nothing scheduled at all                             | `episodic.enabled` is false, or `autoEpisodeIntervalMs` is `null`     |
| Facts extracted but not retrievable                  | Confidence below `retrievalMinConfidence`, or `validAt` in the future |

## Timeouts and caps

|                                       | Value                   |
| ------------------------------------- | ----------------------- |
| Gemini text call                      | 30 s                    |
| Structured call (extraction, judging) | 90 s                    |
| Embedding call                        | 30 s                    |
| Embedding batch size                  | 100 texts per request   |
| Stale `processing` claim              | 10 minutes              |
| Episode retries                       | `maxRetries`, default 3 |
| Semantic retries                      | 3, fixed                |
| Rows per tick                         | 20                      |

None are configurable without editing the source.

## Manual intervention

```sql
-- re-run fact extraction for a dataset
UPDATE episodes
SET semantic_status = 'pending', semantic_retry_count = 0
WHERE dataset = 'user_42' AND status = 'completed';
-- the sweep picks these up within 120 seconds

-- clear a stuck claim immediately
UPDATE episodes SET semantic_status = 'pending' WHERE id = '8b21…';

-- force extraction for a thread without waiting for the timer
-- (prefer the API: POST /v1/threads/:id/end)
```

Re-running extraction costs LLM calls and re-judges contradictions. Existing
facts are protected by deduplication, so it is safe, just not free.

## Next

- [The extraction pipeline](/concepts/extraction-pipeline/), what these jobs run
- [Self-hosting](/operations/self-hosting/)
- [Episodic memory API](/api/episodic-memory/), manual retries

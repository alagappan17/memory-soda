---
title: "Limits and defaults"
description: "Every constraint in one place. Values marked hard-coded require a source change."
---
Every constraint in one place. Values marked **hard-coded** require a source
change.

---

## Request limits

| Limit | Value | |
|---|---|---|
| Request body | **1 MB** | hard-coded |
| `content` (message) | no explicit cap | bounded by the body limit |
| `dataset` | 1–256 characters | |
| `query` (recall) | max 2000 characters | |
| `q` (fact search) | max 1000 characters | |
| `q` (episode search) | 1–1000 characters | |
| Project name | 1–100 characters | |
| Project description | max 500 characters | |
| API key name | 1–100 characters | |
| Username | 1–100 characters | |
| Password | 6–200 characters | |

---

## Pagination

| Endpoint | Default | Max |
|---|---|---|
| `GET …/messages` | 20 | 100 |
| `prepare` `messageLimit` | 20 | 100 |
| `recall` `limit` | 8 (`factsInContext`) | 100 |
| `GET …/facts` (`/v1`) | 50 | 100 |
| `GET …/facts` (dashboard) | 100 | 200 |
| `GET …/episodes` (`/v1`) | 10 | 50 |
| `GET …/episodes` (dashboard) | 50 | 100 |
| `GET …/episodes/search` | 5 | 20 |
| `GET /dashboard/threads` | 20 | 100 |
| `GET /dashboard/datasets` | 50 | 100 |
| `GET …/entities` | **unpaginated** | — |

`listEntities` returns every entity for a dataset. Keep it off hot paths.

---

## Rate limits

**None.** Nothing is throttled anywhere, including `/auth/login`. Put a rate
limiter in front if this is reachable beyond a trusted network.

---

## Settings bounds

| Setting | Default | Range |
|---|---|---|
| `episodic.autoEpisodeIntervalMs` | `10000` | `>= 60000` (project) · `>= 1000` (thread) · `null` |
| `episodic.maxMessages` | `100` | 10–1000 |
| `episodic.maxRetries` | `3` | 0–10 |
| `episodic.contextEpisodes` | `3` | 1–20 |
| `episodic.similarityWeight` | `0.7` | 0–1 |
| `episodic.recencyWeight` | `0.3` | 0–1 |
| `semantic.retrievalMinConfidence` | `0.5` | 0–1 |
| `semantic.factsInContext` | `8` | 1–100 |
| `semantic.entityResolutionThreshold` | `0.88` | 0–1 |
| `semantic.factDedupThreshold` | `0.95` | 0–1 |
| `semantic.contradictionBandMin` | `0.80` | 0–1 |
| `semantic.anchorVectorMin` | `0.75` | 0–1 |
| `semantic.anchorVectorTopK` | `3` | 1–10 |
| `autoCompactThreshold` (thread) | unset | `>= 2` |

Full explanations: [Project settings](/reference/project-settings/).

---

## Extraction limits

**Hard-coded** in `apps/api/src/lib/semantic-extraction.ts`.

| Limit | Value |
|---|---|
| Fact `object` length | 500 characters (truncated) |
| `sourceQuote` length | 200 characters (truncated) |
| Facts per extraction | 1–6 typical, "never more than 10" (prompt guidance) |
| Key learnings per episode | 0–5 typical, capped at 20, each 500 characters |
| Transcript size | `maxMessages`, head 20 + tail, with a marker between |

The fact count is prompt guidance, not enforcement — a model can exceed it.

---

## Model and timeouts

**Hard-coded** in `apps/api/src/lib/gemini.ts`.

| | Value |
|---|---|
| LLM | `gemini-2.5-flash` |
| Embedding model | `gemini-embedding-001` |
| Embedding dimensions | **768** — also baked into the schema |
| Text call timeout | 30 s |
| Structured call timeout | 90 s |
| Embedding timeout | 30 s |
| Embedding batch size | 100 texts per request |
| Thinking budget (structured calls) | 0 — disabled |

Changing the embedding dimension is not a config change: it needs a migration and
a re-embed of every stored vector.

---

## Background jobs

| | Value |
|---|---|
| Scheduled-episode tick | 5 s |
| Retry tick | 120 s |
| Semantic sweep tick | 120 s |
| Rows per tick | 20 |
| Stale `processing` claim | 10 minutes |
| Episode retries | `maxRetries` (3) |
| Semantic retries | 3, **fixed** |

All hard-coded in `main.ts` and the services.

---

## Database

| | Value |
|---|---|
| Connection pool max | **20**, hard-coded |
| Idle timeout | 30 s |
| Connection timeout | 2 s |
| Session lifetime | 7 days |
| scrypt parameters | `N=2^15, r=8, p=3` — 32 MiB per derivation |

Provision at least 25 Postgres connections for the API, plus headroom for
migrations and tooling.

---

## Scaling characteristics

### The one to watch

> **The extraction pipeline loads every live fact for a dataset into process
> memory — embeddings included — on each run.**

At 768 dimensions, a fact embedding is ~3 KB.

| Live facts in one dataset | Memory per extraction | |
|---|---|---|
| 100 | ~0.3 MB | fine |
| 1,000 | ~3 MB | fine |
| 10,000 | ~30 MB | noticeable |
| 100,000 | ~300 MB | will hurt |

Two costs compound: the memory, and the JS-side cosine comparison of every
candidate against every live fact during deduplication and contradiction
detection.

Real datasets grow slowly — extraction emits 1–6 facts per episode and
deduplicates aggressively — so most stay in the low hundreds. Watch the outliers:

```sql
SELECT dataset, count(*) AS live_facts
FROM facts WHERE invalid_at IS NULL
GROUP BY 1 ORDER BY 2 DESC LIMIT 20;
```

### Everything else

| Dimension | Notes |
|---|---|
| Datasets per project | Effectively unlimited — a string in a `WHERE` clause, no per-dataset provisioning |
| Threads per dataset | Unlimited |
| Messages per thread | Unlimited; use compaction to bound the context window |
| Episodes per thread | One `completed` at a time; older ones are archived |
| Entities per dataset | Unlimited, but `listEntities` is unpaginated |
| Concurrent API instances | **One** — see [Background jobs](/operations/background-jobs/#single-instance) |

---

## Latency

| Operation | Typical |
|---|---|
| `addMessage` | 5–15 ms |
| `addMessage` triggering compaction | **up to 30 s** |
| `prepare` | 10–30 ms |
| `recall` with a query | 200–500 ms |
| `recall` without a query | 20–50 ms |
| `recall` with `synthesis` | 1.5–3.5 s |
| `compact` | seconds — one LLM call |
| Message → fact retrievable | **20–60 s** |
| Login | ~200 ms — scrypt, deliberately |

---

## Cost per unit of work

| Unit | LLM calls | Embedding batches |
|---|---|---|
| One episode | 3 — summary, extraction, contradiction judging | 3 — summary, entity names, fact strings |
| One compaction | 1 | 0 |
| One `recall` with a query | 0 | 1 |
| One `recall` with `synthesis` | 1 | 1 |
| One `POST …/chat` | 2–3 | 1 |

**The biggest lever is `autoEpisodeIntervalMs`.** At the default of 10 seconds, a
conversation with several natural pauses produces several episodes and pays the
per-episode cost each time.

---

## Storage

| | Approximate |
|---|---|
| One message | content + ~200 bytes |
| One fact | ~3.2 KB — dominated by the embedding |
| One entity | ~3.1 KB |
| One episode | summary + ~3.1 KB |

Embeddings dominate and compress poorly, so `pg_dump` output scales with fact and
entity counts rather than message volume.

---

## Not implemented

Limits that do not exist, and might surprise you:

| | |
|---|---|
| Facts per dataset | No cap. Memory never shrinks — no forgetting, decay or consolidation |
| Retention | Nothing expires |
| Message size | Only the 1 MB body limit |
| Concurrent requests | No queueing or shedding |
| API key expiry | Keys are valid until revoked |

---

## Next

- [Project settings](/reference/project-settings/)
- [Self-hosting](/operations/self-hosting/) — sizing
- [Background jobs](/operations/background-jobs/) — monitoring

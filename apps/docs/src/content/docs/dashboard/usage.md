---
title: 'Usage'
description: 'What the platform spent on a project: model calls, embeddings, cost, latency, and memory growth, with filters.'
---

What Memory Soda itself spent on the **currently selected project**: every
model call and embedding batch it made, what they cost, how long they took,
and how memory grew over the window.

This is the platform's own spend. The tokens your application reports on
messages (`tokens` on `addMessage`) are shown separately as _stored message
tokens_ and never counted as cost.

## Where the numbers come from

Every unit of work that costs money or time writes one row to the
`usage_logs` table:

| `kind`  | One row per                   | Examples of `stage`                                                                              |
| ------- | ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `llm`   | text or structured completion | `extract_episode`, `extract_graph`, `resolve_contradictions`, `summarize`, `synthesize`, `reply` |
| `embed` | embedding batch (≤100 texts)  | `embed_summary`, `embed_entities`, `embed_facts`, `embed_query`                                  |
| `span`  | timed operation, no model     | `recall`, `episode`, `semantic`, `compact`, `http`                                               |

Each row also records **where** it came from: `source` (`api` for an SDK key,
`dashboard` for a signed-in session, `worker` for a background job), the API
key, the user, the dataset, thread and episode, and a `request_id` shared by
every row one request or job produced. Anything else (message counts, fact
counts, HTTP status) lives in a `meta` JSON column.

**Cost is never stored.** It is computed when you look, from the row's
`service` + `model` and a price table in `apps/api/src/lib/usage.ts`
(USD per million tokens). A model with no entry shows as _unpriced_ rather
than `$0`. Gemini's embedding API returns no token count, so embedding cost is
estimated from characters (÷ 4).

Logging is best-effort and off the request path: rows are buffered in memory
and written in one batch every five seconds. A crash can lose a few seconds of
rows; a request is never slowed.

## The page

**Filters** (top row): window (7 / 30 / 90 days, 12 months, which also sets the
bucket to day / week / month), dataset, source, stage, and service / model.
Options are taken from the current result, so a filter only offers values
that exist.

### Overview

Stat tiles for the window: cost, tokens (in / out), calls and error rate,
p95 / p50 latency, live and invalidated facts, episodes by status, threads,
and stored message tokens. Below them, per-bucket bars for cost, tokens,
calls and errors, and _by dataset_ / _by API key_ tables answering "who is
costing me".

### Breakdown

One table, grouped by your choice of **stage**, **operation** (the route or
worker job), **service / model**, **source**, or **kind**, with calls, errors,
tokens, cost and p50 / p95 latency. Spans are timing-only and show no cost.

### Memory

New threads, messages, episodes, facts and entities per bucket.

### Logs

The raw rows, newest first, with the same filters. Expand a row for its
request id, dataset, thread, episode, error and `meta`.

## API

Dashboard-only, session-authenticated; there is no SDK counterpart.

```
GET /dashboard/projects/:projectId/usage?from=…&to=…&bucket=day|week|month
    [&dataset=&source=&operation=&stage=&kind=&service=&model=&apiKeyId=]
GET /dashboard/projects/:projectId/usage/logs?limit=50[&cursor=<createdAt>]  (+ same filters)
```

`from` / `to` default to the last 30 days.

## Adding a model or provider

The log is provider-neutral: a new client logs with its own `service` and
`model`, and the page groups by them automatically. To price it, add one row
to `PRICES` in `apps/api/src/lib/usage.ts`. Nothing else changes.

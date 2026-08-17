---
title: "API conventions"
description: "Everything on this page applies to every endpoint."
---
Everything on this page applies to every endpoint.

**Base URL:** `http://localhost:3004` by default (`HOST` + `PORT`).

---

## Surfaces

Three, with different auth.

| Prefix | Audience | Auth |
|---|---|---|
| `/health` | monitoring | none |
| `/auth/*` | dashboard sign-in | none for `login`; session for `logout`, `me` |
| `/dashboard/*` | the dashboard UI | login session |
| `/v1/*` | your application | API key |

Only `/v1/*` is a stable integration surface. `/dashboard/*` exists for the
bundled UI and may change without notice.

---

## Authentication

```
Authorization: Bearer ms_3f9a…            # /v1/*        API key
Authorization: Bearer ms_sess_a1b2…       # /dashboard/* session token
```

Details: [Authentication](/api/authentication/).

---

## Requests

- `Content-Type: application/json` on every request with a body
- Bodies are capped at **1 MB**
- Unknown fields are **stripped, not rejected** — a typo in an optional field
  name is silently ignored
- Path parameters containing `/` or other reserved characters must be
  percent-encoded (`dataset` in particular)

---

## Responses

Success bodies are JSON objects. There is **no envelope** — the resource is the
body:

```json
{ "threadId": "f2cb…", "dataset": "user_42", "createdAt": "…" }
```

Collections use a named key plus counts:

```json
{ "messages": [...], "total": 42, "hasMore": true }
{ "facts": [...], "total": 17 }
{ "entities": [...] }
```

### Status codes

| Code | When |
|---|---|
| `200` | Success |
| `201` | Created — `POST /v1/threads`, `POST …/messages`, `POST …/chat` |
| `204` | Success, no body — logout, delete |
| `400` | Validation failed |
| `401` | Missing, invalid or revoked credential |
| `404` | Not found, or not yours |
| `409` | Conflict |
| `500` | Server error |
| `503` | `/health` only, when a dependency is down |

---

## Errors

```json
{ "error": "Thread not found" }
```

Validation failures add the raw zod issues:

```json
{
  "error": "Validation error",
  "issues": [
    { "code": "too_small", "minimum": 1, "type": "string",
      "path": ["content"], "message": "String must contain at least 1 character(s)" }
  ]
}
```

> There is no machine-readable error code and no request ID. Branch on HTTP
> status, not on the `error` string — the strings are not stable.
> [Errors reference](/reference/errors/).

---

## Tenancy

You never pass a project ID to `/v1/*`. It is resolved from your API key on
every request, and every query filters on it.

`dataset` is a path or body parameter you choose. It is created implicitly on
first write — there is no provisioning call.

```
/v1/memory/semantic/datasets/user_42/facts
                             ^^^^^^^ percent-encode if it contains / ? # etc.
```

---

## Pagination

Two styles, depending on the endpoint.

**Cursor** — messages, keyed on `sequenceNumber`:

```
GET /v1/memory/working/threads/:id/messages?limit=50&before=120&order=desc
→ { messages, total, hasMore }
```

**Cursor by timestamp** — episodes:

```
GET /v1/memory/episodic/datasets/:dataset/episodes?limit=10&before=2026-08-01T00:00:00Z
→ { episodes, total, hasMore }
```

**Offset** — dashboard lists only:

```
GET /dashboard/threads?projectId=…&limit=20&offset=40
→ { threads, total }
```

Facts and entities are **not paginated** — `listFacts` caps at `limit` (max 100)
with a `total`, and `listEntities` returns everything.

---

## Query parameter coercion

Query strings are coerced before validation:

- numbers: `?limit=50` → `50`
- booleans: `?includeInvalidated=true` accepts `true`/`false`/`1`/`0`
- dates: `?asOf=2026-06-01` and full ISO datetimes both parse

Out-of-range values return `400` rather than clamping.

---

## Idempotency

There are no idempotency keys.

| Endpoint | Repeat behaviour |
|---|---|
| `POST /v1/threads` | New thread each time |
| `POST …/messages` | Duplicate message appended |
| `POST …/end` | Another episode (harmless, costs 3 LLM calls) |
| `POST …/compact` | No-op when nothing to compact |
| `DELETE …/facts/:id` | `404` on the second call |
| All `GET`s | Safe |

---

## Rate limits

**None.** Nothing is throttled, including `/auth/login`. If you expose this
beyond a trusted network, put a rate limiter in front of it.

---

## CORS

Controlled by `CORS_ORIGIN`, default `http://localhost:3000`. Comma-separated for
multiple origins.

Only the dashboard should call this API from a browser. Your application's calls
belong on a server — an API key in client-side code grants full access to every
dataset in its project.

---

## Versioning

The integration surface is under `/v1`. It is pre-1.0 and the shape may still
change; changes will be noted in the changelog.

`/dashboard/*` and `/auth/*` are unversioned and internal.

---

## Endpoint index

| Endpoint | Page |
|---|---|
| `POST /v1/threads`, `GET/PATCH /v1/threads/:id`, `POST /v1/threads/:id/end` | [Threads](/api/threads/) |
| `POST/GET …/threads/:id/messages`, `…/prepare`, `…/chat`, `…/compact`, `…/stats` | [Working memory](/api/working-memory/) |
| `POST /v1/memory/recall` | [Recall](/api/recall/) |
| `GET/DELETE …/semantic/datasets/:dataset/facts`, `…/entities` | [Semantic memory](/api/semantic-memory/) |
| `GET/DELETE/POST …/episodic/…` | [Episodic memory](/api/episodic-memory/) |
| `/auth/*`, `/dashboard/*` | [Dashboard routes](/api/dashboard/) |
| `GET /health` | below |

---

## `GET /health`

Public. No auth.

```bash
curl http://localhost:3004/health
```

```json
{ "status": "ok", "services": { "postgres": "ok" } }
```

Returns `200` when everything is `ok`, `503` otherwise. It checks that Postgres
answers `SELECT 1` — it does **not** check Gemini reachability, migration state,
or whether background jobs are keeping up.

---

## Next

- [Authentication](/api/authentication/)
- [Threads](/api/threads/)

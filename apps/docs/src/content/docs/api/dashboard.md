---
title: "Dashboard routes"
description: "Base paths: /auth and /dashboard · Auth: session token"
---
Base paths: `/auth` and `/dashboard` · Auth: [session token](/api/authentication/#dashboard-sessions)

These back the bundled dashboard UI. They are **not an integration surface** —
they are unversioned and may change without notice. Documented so you can script
administration.

> An API key does **not** work here, and a session token does not work on
> `/v1/*`.

---

## Auth

### `POST /auth/login`

Public.

```json
{ "username": "admin", "password": "…" }
```

```json
{
  "token": "ms_sess_1bbe…",
  "user": { "id": "61a8…", "username": "admin", "createdAt": "…", "updatedAt": "…" }
}
```

`401 Invalid username or password` for both an unknown user and a wrong
password. Sessions last 7 days.

### `POST /auth/logout`

Session required. `204`, and the token is revoked immediately.

### `GET /auth/me`

```json
{ "user": { "userId": "61a8…", "username": "admin" } }
```

---

## Users

### `GET /dashboard/users`

```json
{ "users": [ { "id": "61a8…", "username": "admin", "createdAt": "…", "updatedAt": "…" } ] }
```

Password hashes are never returned.

### `POST /dashboard/users`

```json
{ "username": "alice", "password": "at-least-6-chars" }
```

`201` → `{ "user": { … } }`

| Code | Cause |
|---|---|
| `409` | Username already taken |
| `400` | Username 1–100 chars, password 6–200 chars |

### `DELETE /dashboard/users/:id`

`204` on success.

| Code | Cause |
|---|---|
| `400` | Deleting yourself |
| `400` | Deleting the last remaining user |
| `404` | No such user |

Both guards exist to prevent locking everyone out. The last-user check runs in a
transaction with the rows locked, so concurrent deletes cannot both slip past it.

> There is **no password-change endpoint**. Create a new user and delete the old
> one, or update the hash directly in SQL.

---

## Projects

### `GET /dashboard/projects`

```json
{ "projects": [ { "id": "ea43…", "name": "default",
                  "description": "Auto-created default project", "createdAt": "…" } ] }
```

### `POST /dashboard/projects`

```json
{ "name": "production", "description": "optional, max 500 chars" }
```

`201` → `{ "project": { … } }`

### `PATCH /dashboard/projects/:id`

```json
{ "name": "renamed", "description": "…" }
```

`name` is required.

### `DELETE /dashboard/projects/:id`

`204`.

> **Does not cascade in the application layer.** Threads, facts and entities are
> removed by database-level `ON DELETE CASCADE`; API keys for the project are
> removed too. This is destructive and irreversible — everything the project
> remembered is gone.

### `GET /dashboard/projects/:id/settings`

```json
{
  "settings": {
    "episodic": { "enabled": true, "autoEpisodeIntervalMs": 10000, "maxMessages": 100,
                  "maxRetries": 3, "contextEpisodes": 3,
                  "similarityWeight": 0.7, "recencyWeight": 0.3 },
    "semantic": { "enabled": true, "retrievalMinConfidence": 0.5, "factsInContext": 8,
                  "entityResolutionThreshold": 0.88, "factDedupThreshold": 0.95,
                  "contradictionBandMin": 0.8, "anchorVectorMin": 0.75,
                  "anchorVectorTopK": 3 }
  }
}
```

Always merged with defaults, so every field is present.

### `PATCH /dashboard/projects/:id/settings`

Partial, deep-merged:

```json
{ "semantic": { "factsInContext": 12 } }
```

Bounds are in [Project settings](/reference/project-settings/).

> `episodic.autoEpisodeIntervalMs` is validated as `>= 60000` here, but the
> **default is 10000** and thread-level overrides accept `>= 1000`. The default
> cannot be set through this endpoint.

---

## API keys

### `GET /dashboard/api-keys`

```json
{ "apiKeys": [ { "id": "93fe…", "name": "production", "keyPreview": "ms_3f9a4c…0161",
                 "projectId": "ea43…", "createdAt": "…",
                 "lastUsedAt": "…", "revokedAt": null } ] }
```

Full key values are never returned — only a preview.

### `POST /dashboard/api-keys`

```json
{ "name": "production", "projectId": "ea43…" }
```

`projectId` is optional; it falls back to the default project.

`201`:

```json
{ "key": "ms_3f9a…", "apiKey": { "id": "93fe…", "…": "…" } }
```

**`key` appears here and never again.**

### `DELETE /dashboard/api-keys/:id`

`204`. Immediate and permanent — `revokedAt` is stamped and the row is kept.

Takes the **key id**, not the key value.

---

## Threads

### `GET /dashboard/threads`

| Param | Required | Default |
|---|---|---|
| `projectId` | **yes** | — |
| `dataset` | no | — |
| `limit` | no | `20` (1–100) |
| `offset` | no | `0` |

```json
{
  "threads": [
    { "threadId": "f2cb…", "dataset": "user_42", "projectId": "ea43…",
      "tags": [], "messageCount": 2, "metadata": null,
      "createdAt": "…", "updatedAt": "…", "lastActivityAt": "…" }
  ],
  "total": 1
}
```

`messageCount` is derived live with a correlated subquery, not stored.

### `GET /dashboard/threads/:threadId/messages`

Requires `?projectId=`.

```json
{ "thread": { "…": "…" }, "messages": [ { "…": "…" } ] }
```

Every message in sequence order, including compacted ones.

### `GET /dashboard/threads/:threadId/episodes`

Requires `?projectId=`. Every episode for the thread, newest first, regardless of
status.

---

## Datasets

These duplicate the `/v1/memory/*` equivalents behind session auth rather than an
API key.

### `GET /dashboard/datasets`

| Param | Required | Default |
|---|---|---|
| `projectId` | **yes** | — |
| `q` | no | — (ILIKE filter on the dataset name) |
| `limit` | no | `50` (1–100) |
| `offset` | no | `0` |

```json
{
  "users": [
    { "dataset": "user_42", "threadCount": 3, "factCount": 17,
      "lastActivityAt": "2026-08-16T09:14:02.114Z" }
  ],
  "total": 1
}
```

> The key is `users`, not `datasets`. The list is derived from `threads`, so a
> dataset with facts but no threads will not appear.

### `GET /dashboard/datasets/:dataset/facts`

`?projectId=` required. Also `q`, `includeInvalidated`, `limit` (max 200).

Same shape as [`GET /v1/…/facts`](/api/semantic-memory/).

### `GET /dashboard/datasets/:dataset/entities`

`?projectId=` required. → `{ "entities": [...] }`

### `GET /dashboard/datasets/:dataset/episodes`

`?projectId=` required. Also `status` (accepts `all` and `archived` here, unlike
the `/v1` route), `limit` (max 100), `before`.

### `DELETE /dashboard/datasets/:dataset/facts/:factId`

`?projectId=` required. → `{ "factId": "…", "deleted": true }`

---

## Scripting administration

```bash
API=http://localhost:3004

TOKEN=$(curl -s -X POST $API/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"'"$ADMIN_PASSWORD"'"}' | jq -r .token)

PROJECT=$(curl -s $API/dashboard/projects \
  -H "Authorization: Bearer $TOKEN" | jq -r '.projects[0].id')

# Issue a key for CI
curl -s -X POST $API/dashboard/api-keys \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"name\":\"ci\",\"projectId\":\"$PROJECT\"}" | jq -r .key

curl -s -X POST $API/auth/logout -H "Authorization: Bearer $TOKEN"
```

---

## Authorization caveat

`/dashboard/*` checks that **a valid session exists** — not that the user owns
the `projectId` they passed. Any signed-in dashboard user can read and modify
any project.

Fine for the intended single-tenant self-hosted deployment. If you need
per-user project isolation, it does not exist yet.

---

## Next

- [Authentication](/api/authentication/)
- [Dashboard overview](/dashboard/)

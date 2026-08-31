---
title: 'Errors'
description: 'Every failure mode: status codes, error messages by endpoint, and the silent failures.'
---

## Shape

```json
{ "error": "Thread not found" }
```

Validation failures add the raw zod issues:

```json
{
  "error": "Validation error",
  "issues": [
    {
      "code": "too_small",
      "minimum": 1,
      "type": "string",
      "inclusive": true,
      "path": ["content"],
      "message": "String must contain at least 1 character(s)"
    }
  ]
}
```

> There is **no machine-readable error code** and **no request ID**. Branch on
> HTTP status, the `error` strings are not a stable contract.

## Status codes

| Code  | Meaning                                | Retry?              |
| ----- | -------------------------------------- | ------------------- |
| `400` | Validation failed                      | No, fix the request |
| `401` | Missing, invalid or revoked credential | No, configuration   |
| `404` | Not found, or not yours                | No                  |
| `409` | Conflict (dashboard user creation)     | No                  |
| `500` | Server error                           | Yes, with backoff   |
| `503` | `/health` only, a dependency is down   | Yes                 |

`403` is never returned. Authorisation failures surface as `401` or `404`.

## Authentication

### API key, `/v1/*`

| Message                                   | Cause                                                                |
| ----------------------------------------- | -------------------------------------------------------------------- |
| `Missing or invalid Authorization header` | No header, or missing the `Bearer ` prefix                           |
| `Invalid API key`                         | No matching hash, typo, truncation, or a key from another deployment |
| `API key has been revoked`                | `revokedAt` is set                                                   |

### Session, `/dashboard/*`

| Message                                   | Cause                     |
| ----------------------------------------- | ------------------------- |
| `Missing or invalid Authorization header` | As above                  |
| `Invalid session`                         | No matching hash          |
| `Session has been revoked`                | Signed out                |
| `Session has expired`                     | Past `expiresAt` (7 days) |
| `Session user no longer exists`           | The user was deleted      |

### Login

`POST /auth/login` returns `401 Invalid username or password` for both an unknown
user and a wrong password, deliberately indistinguishable, and both paths do the
same scrypt work so latency cannot enumerate accounts.

## By endpoint

Every `500` below is the same generic body, `{ "error": "Internal server error" }`,
regardless of which route raised it — the detail is logged server-side, never
returned. Only `400`/`404`/`409` carry a specific message.

### Threads

| Endpoint                   | Code  | Message          |
| -------------------------- | ----- | ---------------- |
| `POST /v1/threads`         | `400` | Validation error |
| `GET /v1/threads/:id`      | `404` | Thread not found |
| `PATCH /v1/threads/:id`    | `400` | Validation error |
|                            | `404` | Thread not found |
| `POST /v1/threads/:id/end` | `404` | Thread not found |

### Working memory

| Endpoint          | Code  | Message          |
| ----------------- | ----- | ---------------- |
| `POST …/messages` | `400` | Validation error |
|                   | `404` | Thread not found |
| `GET …/messages`  | `400` | Validation error |
|                   | `404` | Thread not found |
| `POST …/prepare`  | `404` | Thread not found |
| `POST …/chat`     | `404` | Thread not found |
| `POST …/compact`  | `404` | Thread not found |
| `GET …/stats`     | `404` | Thread not found |

### Recall

| Code  | Message                                                                            |
| ----- | ---------------------------------------------------------------------------------- |
| `400` | Validation error, `dataset` missing, `query` over 2000 chars, `limit` out of 1–100 |

Recall degrades internally rather than failing: a failed query embedding falls
back to keyword and recency, a failed episode fetch returns `episodes: null`, a
failed synthesis returns `synthesis: null`. A `500` means the whole request
failed.

### Semantic memory

| Endpoint                     | Code  | Message                                                        |
| ---------------------------- | ----- | -------------------------------------------------------------- |
| `GET …/facts`                | `400` | Validation error                                               |
| `DELETE …/facts/:id`         | `404` | Fact not found, unknown, wrong dataset, or already invalidated |
| `GET …/entities/:name/facts` | ,     | Unknown entity returns `{ "facts": [] }`, not `404`            |

### Episodic memory

| Endpoint                    | Code  | Message                                                                        |
| --------------------------- | ----- | ------------------------------------------------------------------------------ |
| `GET …/episodes`            | `400` | Validation error, `status` must be `pending`/`processing`/`completed`/`failed` |
| `GET …/episodes/search`     | `400` | `q` required, 1–1000 chars                                                     |
| `GET …/episodes/:id`        | `404` | Episode not found                                                              |
| `DELETE …/episodes/:id`     | `400` | Episode is already archived                                                    |
|                             | `404` | Episode not found                                                              |
| `POST …/episodes/:id/retry` | `400` | Only failed episodes can be retried                                            |
|                             | `404` | Episode not found                                                              |

### Dashboard

| Endpoint                                 | Code  | Message                                          |
| ---------------------------------------- | ----- | ------------------------------------------------ |
| `POST /dashboard/users`                  | `409` | Username already taken                           |
|                                          | `400` | Validation error, username 1–100, password 6–200 |
| `DELETE /dashboard/users/:id`            | `400` | You cannot delete your own account               |
|                                          | `400` | Cannot delete the last user                      |
|                                          | `404` | User not found                                   |
| `GET /dashboard/projects/:id/settings`   | `404` | Project not found                                |
| `PATCH /dashboard/projects/:id/settings` | `400` | Validation error                                 |
| Most `/dashboard/*` list routes          | `400` | Validation error, usually a missing `projectId`  |

## SDK mapping

| HTTP                                  | SDK error                           |
| ------------------------------------- | ----------------------------------- |
| 401, 403                              | `AuthError`                         |
| any other non-2xx                     | `ApiError` with `status` and `body` |
| connection failure, DNS, TLS, timeout | `NetworkError` with `networkCause`  |

`AuthError` is checked **before** `ApiError`, so an auth failure is never an
`ApiError`.

```ts
import { ApiError, AuthError, NetworkError } from '@memory-soda/sdk';

try {
  await memory.recall({ dataset, query });
} catch (err) {
  if (err instanceof AuthError) throw err; // config, fail loudly
  if (err instanceof NetworkError) return { context: '' }; // degrade
  if (err instanceof ApiError && err.status >= 500) return { context: '' };
  throw err;
}
```

See [Error handling](/sdk/errors/).

## Silent failures

Not errors, but worth knowing, these succeed while doing less than you expect.

| Behaviour                                              | Consequence                                                                                                                               |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Unknown fields are stripped, not rejected**          | A typo in an optional field name returns `201` and is ignored. Sending `tokenCount` instead of `tokens` silently discards the token data. |
| `recall()` with no matches                             | `200` with `context: ""`, not a `404`                                                                                                     |
| `listFacts({ entity })` on an unknown entity           | `200` with `{ "facts": [] }`                                                                                                              |
| `compact()` with nothing to do                         | `200` with a **different response shape**, `{ ok, compacted: false, message }`                                                            |
| `prepare()` with `messageLimit < autoCompactThreshold` | `200` with a `warning` field. Messages are missing from context.                                                                          |
| Extraction failure                                     | No error anywhere on the API. `semantic_status` becomes `failed` and is not exposed on any endpoint                                       |

That last one matters most: **fact extraction can be failing for every episode
while every API call returns 200 and `/health` stays green.** Monitor it in SQL,
see [Background jobs](/operations/background-jobs/#monitoring).

## Debugging

**Everything 401s**, confirm the credential matches the surface. API keys do not
work on `/dashboard/*`, session tokens do not work on `/v1/*`.

**`recall()` returns nothing for a user who should have memory**, usually the
wrong project's API key. A key silently scopes every call. Check the dataset
exists in the project the key belongs to.

**A `404` you did not expect**, thread, fact and episode lookups all filter by
the project resolved from your key. Not-found and not-yours are the same
response.

**A `400` you cannot parse**, read `body.issues`; `path` names the offending
field.

**Nothing is being extracted**, check `episodic.enabled`,
`autoEpisodeIntervalMs`, and then:

```sql
SELECT status, semantic_status, count(*), left(max(error), 120) AS sample_error
FROM episodes GROUP BY 1, 2;
```

## Next

- [SDK error handling](/sdk/errors/)
- [API conventions](/api/)
- [Background jobs](/operations/background-jobs/), monitoring silent failures

---
title: 'Authentication'
description: 'Two independent credentials for two independent surfaces. They never mix, an API key cannot reach /dashboard/, and a session token cannot reach /v1/.'
---

Two independent credentials for two independent surfaces. They never mix, an
API key cannot reach `/dashboard/*`, and a session token cannot reach `/v1/*`.

| Surface        | Credential                | Grants                                      |
| -------------- | ------------------------- | ------------------------------------------- |
| `/v1/*`        | API key `ms_…`            | Full read/write on **one project's** memory |
| `/dashboard/*` | Session token `ms_sess_…` | The dashboard UI, across all projects       |

---

## API keys

### Format and storage

```
ms_3f9a4c2e…                 'ms_' + 32 random bytes, hex, 67 characters
```

Stored as a **SHA-256 hash**. The plaintext is shown once, at creation, and
cannot be recovered. Losing it means issuing a new one.

Each key belongs to exactly one project. That project is resolved on every
request and scopes every query, which is why you never send a project ID to
`/v1/*`.

### Using one

```bash
curl http://localhost:3004/v1/threads \
  -H "Authorization: Bearer ms_3f9a…" \
  -H 'Content-Type: application/json' \
  -d '{"dataset":"user_42"}'
```

```ts
const memory = new MemorySoda({
  baseUrl,
  apiKey: process.env.MEMORY_SODA_API_KEY!,
});
```

### Getting one

Sign in to the dashboard and create one under **API Keys**, or:

```bash
curl -X POST http://localhost:3004/dashboard/api-keys \
  -H "Authorization: Bearer $SESSION_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"production","projectId":"ea43…"}'
```

```json
{
  "key": "ms_3f9a…",
  "apiKey": {
    "id": "93fe…",
    "name": "production",
    "keyPreview": "ms_3f9a4c…0161",
    "projectId": "ea43…",
    "createdAt": "…",
    "lastUsedAt": null,
    "revokedAt": null
  }
}
```

`key` appears in this response and never again.

### Revoking

```bash
curl -X DELETE http://localhost:3004/dashboard/api-keys/$KEY_ID \
  -H "Authorization: Bearer $SESSION_TOKEN"
```

Immediate, in-flight requests using it start failing at once. Revocation is
permanent; `revokedAt` is stamped and the row is kept.

### Failure modes

| Response                                      | Cause                          |
| --------------------------------------------- | ------------------------------ |
| `401 Missing or invalid Authorization header` | No header, or not `Bearer `    |
| `401 Invalid API key`                         | No matching hash               |
| `401 API key has been revoked`                | `revokedAt` is set             |
| `401 API key is not linked to a project`      | Orphaned row, recreate the key |

The SDK surfaces all of these as [`AuthError`](/sdk/errors/#autherror).

### What a key can do

**Everything in its project.** Read and write every dataset, delete any fact, end
any thread.

There is no read-only key, no per-dataset scoping, and no expiry. If tenants must
not be able to reach each other's data even by accident, give each tenant its own
**project** and its own key.

### Handling

- Server-side only. Never in a browser, mobile app or anything shipped to a user.
- Environment variable, not source control.
- One key per environment and per service, so revoking one is surgical.
- `lastUsedAt` is updated on every request, useful for spotting a key nobody
  uses any more.

---

## Dashboard sessions

For the bundled UI. Not an integration surface.

### Sign in

```bash
curl -X POST http://localhost:3004/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"…"}'
```

```json
{
  "token": "ms_sess_1bbe…",
  "user": {
    "id": "61a8…",
    "username": "admin",
    "createdAt": "…",
    "updatedAt": "…"
  }
}
```

`401 Invalid username or password` covers both an unknown user and a wrong
password, deliberately indistinguishable, and the two paths take the same time
so latency cannot enumerate usernames.

### Session properties

|              |                                                 |
| ------------ | ----------------------------------------------- |
| Lifetime     | 7 days from creation                            |
| Storage      | SHA-256 hash of the token; plaintext shown once |
| Revocation   | Server-side, immediate, `POST /auth/logout`     |
| `lastUsedAt` | Updated on every request                        |

Because sessions are database rows rather than JWTs, signing out actually
invalidates the token.

### Current user

```bash
curl http://localhost:3004/auth/me -H "Authorization: Bearer $SESSION_TOKEN"
```

```json
{ "user": { "userId": "61a8…", "username": "admin" } }
```

### Sign out

```bash
curl -X POST http://localhost:3004/auth/logout -H "Authorization: Bearer $SESSION_TOKEN"
```

### Change password

```bash
curl -X POST http://localhost:3004/auth/password \
  -H "Authorization: Bearer $SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword":"open-sesame","newPassword":"something-longer"}'
```

`204` on success. `401` if the current password is wrong, `400` if the new one
is under 6 characters. Existing sessions, including this one, stay valid.

`204`, and the token 401s from then on.

### Failure modes

| Response                            | Cause                |
| ----------------------------------- | -------------------- |
| `401 Invalid session`               | No matching hash     |
| `401 Session has been revoked`      | Signed out           |
| `401 Session has expired`           | Past `expiresAt`     |
| `401 Session user no longer exists` | The user was deleted |

---

## Password storage

Dashboard passwords use **scrypt** with per-password salts.

```
scrypt$32768$8$3$<salt hex>$<derived key hex>
```

The parameters are recorded in the hash, so they can be raised later without
invalidating existing passwords. `N=2^15, r=8, p=3` is 32 MiB per derivation,
one of the configurations on OWASP's list, chosen over the 128 MiB option so a
small self-hosted box is not exposed to memory exhaustion under concurrent
sign-ins.

Older hashes in the legacy `salt:hex` format still verify and are **transparently
re-hashed** with current parameters on the next successful sign-in.

Comparison is constant-time.

---

## First boot

On an empty database, the API seeds an admin login. No API key is seeded;
create the first one from the dashboard:

```
[ setup ] admin user "admin" created. Sign in to the dashboard and change the password.
```

- `ADMIN_USERNAME` defaults to `admin`, `ADMIN_PASSWORD` to `open-sesame`.
- The login response carries `usingDefaultPassword: true` while the shipped
  default is still in use; the dashboard nags until it is changed.
- Lost it? `npm run admin:reset-password -- admin <new-password>` with database
  access, or create another user from the dashboard.

---

## Security posture

Known gaps, so you can compensate:

| Gap                                                    | Mitigation                                                        |
| ------------------------------------------------------ | ----------------------------------------------------------------- |
| **No rate limiting anywhere**, including `/auth/login` | Put a reverse proxy or WAF in front                               |
| Session tokens live in browser `localStorage`          | Readable by any XSS. Serve the dashboard on a trusted origin only |
| No per-dataset or read-only API keys                   | Separate projects per tenant                                      |
| No API key expiry                                      | Rotate manually                                                   |
| No audit log                                           | Front it with request logging if you need one                     |

Memory Soda is designed to run **behind your own network boundary**. Do not
expose it directly to the internet without a proxy handling TLS, rate limiting
and access control.

---

## Next

- [API conventions](/api/)
- [Dashboard routes](/api/dashboard/)
- [Self-hosting](/operations/self-hosting/)

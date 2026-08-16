# API keys

Issue and revoke the credentials your application uses against `/v1/*`.

Keys belong to the **currently selected project** — check the switcher in the
sidebar footer before creating one.

---

## The page

Lists every key for the project:

| Column | |
|---|---|
| Name | Whatever you called it |
| Key | A preview — `ms_3f9a4c…0161`. The full value is never shown again. |
| Created | |
| Last used | Updated on every request that key authenticates. `—` if never used. |
| Status | `Active` or `Revoked` |

**Last used** is the useful one: it tells you which keys are dead and safe to
revoke.

---

## Creating

**Create key** → give it a name → the full key is shown **once**.

```
ms_3f9a4c2e8b1d7f0a5c3e9b2d4f6a8c1e3b5d7f9a0c2e4b6d8f1a3c5e7b9d0f2a
```

Copy it now. It is stored as a SHA-256 hash and cannot be recovered — losing it
means issuing another.

### Naming

Name keys after **where they run**, so revoking is surgical:

```
production-api      staging-api      ci          local-dev-alice
```

Not `key1`, `test`, `new`.

---

## Revoking

**Revoke** takes effect immediately — in-flight requests using that key start
returning `401 API key has been revoked`.

Permanent. The row is kept with `revokedAt` stamped, so the audit trail survives,
but the key can never be reactivated.

### Rotating without downtime

1. Create the replacement.
2. Deploy it to the consuming service.
3. Confirm the old key's **Last used** stops advancing.
4. Revoke the old key.

---

## What a key grants

**Full read and write access to every dataset in its project.**

A key can:

- create threads and append messages for any dataset
- recall any dataset's memory
- delete any fact
- end any thread

There is **no** read-only key, no per-dataset scoping, and no expiry.

### Consequences

- **Server-side only.** Never ship a key to a browser, mobile app, or anything a
  user can read. Anyone holding it can read every user's memory in that project.
- **One key per environment and service.** So a leak is contained and revocation
  does not take down everything at once.
- **Environment variables, not source control.**

```bash
MEMORY_SODA_BASE_URL=http://localhost:3004
MEMORY_SODA_API_KEY=ms_3f9a…
```

```ts
const memory = MemorySodaClient.fromEnv();
```

If you need one tenant to be unable to reach another's data even by mistake, the
boundary is a [project](./projects.md), not a key.

---

## The first key

Printed once on first boot alongside the admin login. If you missed it, just
create another here — there is nothing special about the first one.

---

## Scripting

```bash
API=http://localhost:3004
TOKEN=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"'"$ADMIN_PASSWORD"'"}' | jq -r .token)

# List (previews only)
curl -s $API/dashboard/api-keys -H "Authorization: Bearer $TOKEN" | jq

# Create — capture .key immediately, it is never returned again
curl -s -X POST $API/dashboard/api-keys \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"ci","projectId":"ea43…"}' | jq -r .key

# Revoke by key id, not key value
curl -s -X DELETE $API/dashboard/api-keys/93fe… -H "Authorization: Bearer $TOKEN"
```

Full reference: [Dashboard routes](../api/dashboard.md#api-keys).

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `401 Missing or invalid Authorization header` | No header, or missing the `Bearer ` prefix |
| `401 Invalid API key` | Typo, truncation, or a key from a different deployment |
| `401 API key has been revoked` | Revoked here |
| `401 API key is not linked to a project` | Orphaned row — create a new key |
| Recall returns nothing | Often the **wrong project's** key — memory lives in a different one |

That last one is the common trap. A key silently scopes every call; if your data
seems to have vanished, confirm the key belongs to the project you wrote to.

---

## Next

- [Authentication](../api/authentication.md)
- [Projects](./projects.md)
- [Playground](./playground.md) — needs a key

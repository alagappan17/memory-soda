---
title: "Error handling"
description: "Every SDK method rejects on failure. Nothing returns null to signal an error."
---
Every SDK method rejects on failure. Nothing returns `null` to signal an error.

```ts
import { ApiError, AuthError, NetworkError, MemorySodaError } from '@alagappan17/memory-soda';
```

---

## Hierarchy

```
Error
└── MemorySodaError          base, catch this to catch everything
    ├── ApiError             the server responded with a non-2xx
    ├── AuthError            401 or 403
    └── NetworkError         the request never completed
```

### `ApiError`

```ts
class ApiError extends MemorySodaError {
  readonly status: number;   // HTTP status
  readonly body: unknown;    // parsed JSON body, or null
}
```

```ts
try {
  await memory.getThread(threadId);
} catch (err) {
  if (err instanceof ApiError && err.status === 404) {
    // gone, or belongs to another project, indistinguishable by design
  }
}
```

`body` is usually `{ error: string }`, and `{ error, issues }` for validation
failures.

### `AuthError`

Thrown for **401 and 403 before** `ApiError` is considered, so an auth failure is
never an `ApiError`.

```ts
class AuthError extends MemorySodaError {
  // message defaults to 'Invalid or missing API key'
}
```

Causes: wrong key, revoked key, key not linked to a project, missing
`Authorization` header. Not retryable, it is a configuration problem.

### `NetworkError`

```ts
class NetworkError extends MemorySodaError {
  readonly networkCause?: unknown;   // the original fetch error / AbortError
}
```

Covers DNS failure, connection refused, TLS problems and **client timeouts**.
A timeout surfaces here, not as an `ApiError`, because no response arrived.

```ts
if (err instanceof NetworkError) {
  const aborted = (err.networkCause as Error)?.name === 'TimeoutError';
}
```

---

## Status codes

| Status | Error | Means |
|---|---|---|
| 400 | `ApiError` | Validation failed, `body.issues` has the zod detail |
| 401 | `AuthError` | Missing, invalid or revoked key |
| 403 | `AuthError` |, |
| 404 | `ApiError` | Thread, fact or episode not found, or not yours |
| 409 | `ApiError` | Conflict (dashboard user creation) |
| 500 | `ApiError` | Server error, safe to retry |
| 503 | `ApiError` | `/health` when a dependency is down |

Full list: [Errors](/reference/errors/).

---

## Handling by kind

```ts
import { ApiError, AuthError, NetworkError } from '@alagappan17/memory-soda';

async function safeRecall(dataset: string, query: string): Promise<string> {
  try {
    const { context } = await memory.recall({ dataset, query });
    return context;
  } catch (err) {
    if (err instanceof AuthError) {
      throw err;                                    // config problem, fail loudly
    }
    if (err instanceof NetworkError) {
      logger.warn({ err }, 'memory unreachable');
      return '';                                    // degrade: answer without memory
    }
    if (err instanceof ApiError && err.status >= 500) {
      logger.error({ status: err.status }, 'memory server error');
      return '';
    }
    throw err;
  }
}
```

**The principle: memory should never take your product down.** An answer without
memory beats no answer.

---

## Retrying

Nothing is retried automatically. Retry `5xx` and network failures; never retry
`4xx`.

```ts
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable =
        err instanceof NetworkError ||
        (err instanceof ApiError && err.status >= 500);
      if (!retryable || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 2 ** i * 250 + Math.random() * 100));
    }
  }
  throw lastErr;
}

const { context } = await withRetry(() => memory.recall({ dataset, query }));
```

### Idempotency

| Operation | Safe to retry? |
|---|---|
| `recall`, `prepare`, `get`, `list*`, `health` | Yes, pure reads |
| `threads.create` | Creates a **new thread** each time |
| `addMessage` | Appends a **duplicate** message |
| `threads.end` | Creates another episode (harmless, costs 3 LLM calls) |
| `compact` | No-op when nothing to compact |
| `deleteFact` | 404 on the second call |

There are no idempotency keys. For writes, retry only on `NetworkError` where you
have reason to believe the request never landed, and accept that a timeout after
the server committed will duplicate.

---

## Timeouts

Set once on the client, applied per request:

```ts
const memory = new MemorySoda({ baseUrl, apiKey, timeout: 15_000 });
```

Defaults to 60 seconds, deliberately generous, because two operations are slow:

| Operation | Can take |
|---|---|
| `addMessage` that triggers auto-compaction | up to ~30 s |
| `recall({ include: ['synthesis'] })` | 1–3.5 s |

A tight global timeout will cut those off. Use two clients if you want a short
timeout on the hot path:

```ts
const fast = new MemorySoda({ baseUrl, apiKey, timeout: 5_000 });
const slow = new MemorySoda({ baseUrl, apiKey, timeout: 60_000 });
```

---

## Validation errors

```ts
try {
  await memory.addMessage(threadId, { role: 'user', content: '' });
} catch (err) {
  if (err instanceof ApiError && err.status === 400) {
    console.log(err.body);
    // { error: 'Validation error',
    //   issues: [{ code: 'too_small', minimum: 1, path: ['content'], … }] }
  }
}
```

`issues` is the raw zod issue array. Useful in development; do not surface it to
end users.

> Unknown fields are **stripped, not rejected**. A typo in an optional field name
> is silently ignored rather than returning 400.

---

## Logging

```ts
function describe(err: unknown) {
  if (err instanceof ApiError) return { kind: 'api', status: err.status, body: err.body };
  if (err instanceof AuthError) return { kind: 'auth' };
  if (err instanceof NetworkError) return { kind: 'network', cause: String(err.networkCause) };
  return { kind: 'unknown', message: String(err) };
}
```

Do not log `err.body` for reads, it can contain user content.

---

## Next

- [Errors reference](/reference/errors/), every endpoint's failure modes
- [Type reference](/sdk/types/)

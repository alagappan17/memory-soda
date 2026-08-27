---
title: "Testing"
description: "Coverage is thin. One suite exists — apps/api/src/lib/password.test.ts — and it covers password hashing only."
---
---

## Current state

Coverage is thin. One suite exists — `apps/api/src/lib/password.test.ts` — and it
covers password hashing only.

The pieces that most need tests and do not have them:

- bi-temporal predicates (`isLiveFact`, `isLiveFactAsOf`)
- fact deduplication — exact, near-duplicate, within-batch
- contradiction reconciliation (`old` / `new` / `neither`)
- compaction — rolling summaries, the `messageLimit` interaction
- RRF fusion ordering
- entity resolution and merging

Contributions there are the highest-value thing in the repo.

---

## Running

```bash
npm run test                                # all projects with a test target
npx nx run @memory-soda/api:test            # just the api
node --test "apps/api/src/**/*.test.ts"     # directly
node --test --watch "apps/api/src/**/*.test.ts"
```

---

## The setup

`node:test`. No framework, no runner, no new dependency.

```json
// apps/api/package.json
"test": {
  "executor": "nx:run-commands",
  "options": { "command": "node --test \"apps/api/src/**/*.test.ts\"" }
}
```

Node 22+ strips TypeScript natively, so `.test.ts` files run directly.

Test files are **excluded from `tsconfig.app.json`**, because they import
siblings by their real `.ts` path (which `tsc` rejects without
`allowImportingTsExtensions`) and are never part of the build.

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from './password.ts';   // ← .ts, not .js
```

> Note the extension. Application code imports `./password.js`, the ESM
> convention. Test files import `./password.ts`, because Node resolves the real
> file. Getting this backwards produces a confusing module-not-found.

---

## Writing a unit test

Colocate as `<module>.test.ts`. Name tests after the behaviour, not the function.

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchorFor, buildFactEmbedString } from './semantic-memory.service.ts';

test('anchors on the object when it is an entity', () => {
  assert.equal(
    anchorFor({ subject: 'user', object: 'berlin', objectIsEntity: true }),
    'berlin',
  );
});

test('falls back to the subject for literal facts', () => {
  assert.equal(
    anchorFor({ subject: 'user', object: 'under $1000', objectIsEntity: false }),
    'user',
  );
});
```

### Test the edges

The password suite caught a real authentication bypass — `Buffer.from('b','hex')`
truncates to an empty buffer, `scrypt` returns an empty key for `keylen: 0`, and
`timingSafeEqual(<empty>, <empty>)` is `true`. A malformed stored hash would have
accepted any password.

It was found by a loop over junk inputs:

```ts
test('returns false rather than throwing on malformed input', async () => {
  for (const stored of ['', 'nonsense', 'scrypt$$$$', 'a:b', 'aa:zz']) {
    const { ok } = await verifyPassword('pw', stored);
    assert.equal(ok, false, `expected false for ${JSON.stringify(stored)}`);
  }
});
```

Cheap to write, and the kind of test that earns its place.

---

## Integration tests

Anything touching the database needs a real Postgres with `pgvector`. There is no
in-memory substitute.

```bash
createdb memory_test
psql -d memory_test -c "CREATE EXTENSION vector;"
DATABASE_URL=postgresql://…/memory_test npm run --workspace=apps/api db:migrate
```

Use a distinct `dataset` prefix per test and clean up — there is no bulk delete,
so test data accumulates.

```ts
const DATASET = `test_${crypto.randomUUID().slice(0, 8)}`;

test.after(async () => {
  await db.delete(threads).where(eq(threads.dataset, DATASET));
  await db.delete(facts).where(eq(facts.dataset, DATASET));
  await db.delete(entities).where(eq(entities.dataset, DATASET));
  await db.delete(episodes).where(eq(episodes.dataset, DATASET));
});
```

Delete facts **before** episodes — `facts.episode_id` is `ON DELETE SET NULL`.

### Testing around async extraction

Extraction takes 20–60 seconds by default. Two ways to make it tractable:

```ts
// 1. shrink the timer
await memory.createThread({
  dataset: DATASET,
  settings: { episodic: { autoEpisodeIntervalMs: 1000 } },
});

// 2. force it
await memory.endThread(threadId);
```

Then poll rather than sleeping a fixed amount:

```ts
async function waitFor<T>(
  fn: () => Promise<T>,
  done: (v: T) => boolean,
  { timeout = 60_000, interval = 2_000 } = {},
): Promise<T> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, interval));
  }
}

const { facts } = await waitFor(
  () => memory.listFacts(DATASET),
  (r) => r.facts.length > 0,
);
```

**These tests call Gemini and cost money.** Keep them out of the default suite —
gate on an env var:

```ts
const LIVE = process.env.RUN_LIVE_TESTS === '1';
test('extracts facts from a conversation', { skip: !LIVE }, async () => { /* … */ });
```

---

## Manual verification

Some things are only verifiable by running them. When you touch retrieval,
extraction, compaction or auth, exercise the real path.

```bash
# boot
npx nx serve api

# auth
curl -s -o /dev/null -w '%{http_code}\n' localhost:3004/dashboard/projects        # 401
TOKEN=$(curl -s -X POST localhost:3004/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"…"}' | jq -r .token)
curl -s localhost:3004/auth/me -H "Authorization: Bearer $TOKEN"                  # 200

# a memory round trip
THREAD=$(curl -s -X POST localhost:3004/v1/threads -H "Authorization: Bearer $KEY" \
  -H 'Content-Type: application/json' -d '{"dataset":"manual_test"}' | jq -r .threadId)
curl -s -X POST localhost:3004/v1/memory/working/threads/$THREAD/messages \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"role":"user","content":"I moved to Berlin and I am learning German."}'
curl -s -X POST localhost:3004/v1/threads/$THREAD/end -H "Authorization: Bearer $KEY"
sleep 30
curl -s -X POST localhost:3004/v1/memory/recall -H "Authorization: Bearer $KEY" \
  -H 'Content-Type: application/json' -d '{"dataset":"manual_test","query":"where do they live?"}' \
  | jq -r .context
```

For the dashboard, the [Playground](/dashboard/playground/) exercises the
whole pipeline and shows every call.

---

## What typecheck will not catch

Real bugs found in this codebase that compiled cleanly and passed every existing
check:

| Bug | Only visible by |
|---|---|
| A correlated subquery binding to the wrong table — every count returned `0` | Running the query |
| Drizzle wrapping pg errors, so a `23505` check never matched and returned 500 instead of 409 | Concurrent requests |
| A Base UI component throwing because it was used outside its required parent | Clicking it |
| The entity-anchor signal contributing arbitrary ranks to fusion | Reading results |

**If you change a query, run it. If you change a component, click it.**

---

## Before opening a PR

```bash
npm run typecheck
npm run build
npm run test
```

Plus a manual pass over whatever you touched.

---

## Next

- [Development setup](/contributing/development/)
- [Releasing the SDK](/contributing/releasing/)

---
title: 'Point-in-time recall'
description: 'asOf answers: what did we believe, about that moment, at that moment?'
---

`asOf` answers: **what did we believe, about that moment, at that moment?**
Nothing is ever physically deleted, so the full history is reconstructable.

## Basic use

```ts
const { context } = await memory.recall({
  dataset: 'user_42',
  asOf: '2026-06-01T00:00:00Z',
});

await memory.listFacts('user_42', { asOf: '2026-06-01' });
```

Accepts a full ISO datetime or a bare date (`2026-06-01`, interpreted as
midnight UTC).

## What it filters on

```sql
created_at   <= $asOf                                    -- the row existed by then
AND valid_at <= $asOf                                    -- and had come into effect
AND (valid_until IS NULL OR valid_until > $asOf)         -- and had not expired
AND (invalid_at  IS NULL OR invalid_at  > $asOf)         -- and was still believed
```

That last line is the interesting one. A fact superseded _after_ `asOf` is
included, because at `asOf` we still believed it.

```
2026-03-01  "I drive a Honda Civic."
2026-08-16  "Actually I switched to a Tesla Model 3."
            → honda civic invalidAt 08-16; tesla model 3 inserted
```

| Query              | Result        | Why                                |
| ------------------ | ------------- | ---------------------------------- |
| `recall()`         | tesla model 3 | Live now                           |
| `asOf: 2026-06-01` | honda civic   | Existed, valid, not yet superseded |
| `asOf: 2026-02-01` | _nothing_     | The fact didn't exist yet          |

## Uses

**Auditing an agent decision.** "Why did it recommend a horror movie on 14
August?" → `recall({ dataset, asOf: '2026-08-14T18:30:00Z', include: ['raw'] })`
returns exactly what the agent knew.

**Distinguishing a bug from a change.** A user reports the assistant "forgot"
something:

```ts
const now = await memory.recall({ dataset, query: 'dietary requirements' });
const then = await memory.recall({
  dataset,
  query: 'dietary requirements',
  asOf: reportedAt,
});

// then has it, now does not → the memory legitimately changed
// neither has it            → it was never extracted
// both have it              → a retrieval or prompt problem
```

**Regression testing.** `asOf` pins the fact set, so a snapshot stays stable as
new memory accumulates:

```ts
const { context } = await memory.recall({
  dataset: 'fixture_user',
  asOf: cutoff,
});
expect(context).toMatchSnapshot();
```

## Important caveat: ranking

> **`asOf` bypasses hybrid retrieval.**

Point-in-time recall falls back to **keyword and recency** only, because the
vector and anchor paths assume the current live set. Results are **correct**,
the right facts for that instant, but a `query` will not find semantic matches.
Raise `limit` to compensate. For auditing this rarely matters, you usually want
_everything_ known at a moment, not the top 8.

## Related reads

```ts
// every fact ever, whatever its state
const { facts } = await memory.listFacts('user_42', {
  includeInvalidated: true,
});
```

`asOf` **overrides** `includeInvalidated` when both are passed. For a timeline
of one fact, filter with `q` and sort by `validAt`.

## Gotchas

**Timezones.** A bare date is midnight **UTC**. If your users are elsewhere,
build the instant explicitly rather than trusting a date string.

**`createdAt` vs `validAt`.** A fact stated today about the past has `validAt`
in the past but `createdAt` today. `asOf` before `createdAt` excludes it, we
did not know it yet, even though it was true. That is the point of
bi-temporality.

**Not free, but cheap.** Same shape as normal recall, minus the embedding call.

## Next

- [The bi-temporal model](/concepts/bi-temporal-model/), the underlying design
- [Curating and correcting memory](/guides/curating-memory/)

---
title: "Point-in-time recall"
description: "asOf answers: what did we believe, about that moment, at that moment?"
---
`asOf` answers: **what did we believe, about that moment, at that moment?**

Because nothing is ever physically deleted, the full history of what the system
knew is reconstructable.

---

## Basic use

```ts
const { context, factCount } = await memory.recall({
  dataset: 'user_42',
  asOf: '2026-06-01T00:00:00Z',
});
```

```bash
curl -X POST $API/v1/memory/recall \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"dataset":"user_42","asOf":"2026-06-01T00:00:00Z"}'
```

Accepts a full ISO datetime or a bare date (`2026-06-01`, interpreted as
midnight UTC).

Also available on the fact list:

```ts
await memory.listFacts('user_42', { asOf: '2026-06-01' });
```

---

## What it filters on

Four conditions, all of which must hold:

```sql
created_at   <= $asOf                                    -- the row existed by then
AND valid_at <= $asOf                                    -- and had come into effect
AND (valid_until IS NULL OR valid_until > $asOf)         -- and had not expired
AND (invalid_at  IS NULL OR invalid_at  > $asOf)         -- and was still believed
```

That last line is the interesting one. A fact superseded *after* `asOf` is
included — because at `asOf` we still believed it.

---

## Worked example

```
2026-03-01  "I live in Berlin."
            → berlin   created 03-01  validAt 03-01  invalidAt null

2026-08-16  "Actually I moved to Lisbon."
            → berlin   invalidAt 08-16
            → lisbon   created 08-16  validAt 08-16  invalidAt null
```

| Query | Result | Why |
|---|---|---|
| `recall()` | lisbon | Live now |
| `asOf: 2026-06-01` | berlin | Existed, valid, not yet superseded |
| `asOf: 2026-02-01` | *nothing* | The fact didn't exist yet |
| `asOf: 2026-09-01` | lisbon | Berlin was superseded on 08-16 |

---

## Uses

### Auditing an agent decision

```ts
async function explainDecision(dataset: string, at: string, question: string) {
  const { context, facts } = await memory.recall({
    dataset,
    asOf: at,
    include: ['raw'],
    limit: 50,
  });
  return { question, at, knewAtTheTime: context, facts };
}

// "Why did it recommend a vegetarian restaurant on 14 August?"
await explainDecision('user_42', '2026-08-14T18:30:00Z', 'restaurant recommendation');
```

### Distinguishing a bug from a change

A user reports the assistant "forgot" something.

```ts
const now = await memory.recall({ dataset, query: 'dietary requirements' });
const then = await memory.recall({ dataset, query: 'dietary requirements', asOf: reportedAt });

// then.context has it, now.context does not → the memory legitimately changed
// neither has it                             → it was never extracted
// both have it                               → a retrieval or prompt problem
```

That triage takes seconds and rules out two of three causes.

### Compliance

Reconstruct the state that drove an automated decision, without keeping a
separate audit log.

### Regression testing

```ts
const cutoff = '2026-08-01T00:00:00Z';
const { context } = await memory.recall({ dataset: 'fixture_user', asOf: cutoff });
expect(context).toMatchSnapshot();
```

Because `asOf` pins the fact set, the snapshot stays stable as new memory
accumulates.

---

## Important caveat: ranking

> **`asOf` bypasses hybrid retrieval.**

Normal recall fuses vector, entity-anchor and keyword signals. Point-in-time
recall falls back to **keyword and recency** only, because the vector and anchor
paths assume the current live set.

Consequences:

| | Normal | With `asOf` |
|---|---|---|
| Vector similarity | ✅ | ❌ |
| Entity anchor | ✅ | ❌ |
| Keyword | ✅ | ✅ |
| Recency | ✅ | ✅ |

- Results are **correct** — the right facts for that instant.
- Ranking is **weaker**. A `query` still filters by keyword but will not find
  semantic matches.
- Raise `limit` to compensate; with fewer signals the top few are less reliable.

```ts
await memory.recall({
  dataset: 'user_42',
  query: 'food',
  asOf: '2026-06-01',
  limit: 30,     // wider net, since ranking is weaker
});
```

For auditing this rarely matters — you usually want *everything* known at a
moment, not the top 8.

---

## Related reads

### Full history, unfiltered by time

```ts
const { facts } = await memory.listFacts('user_42', {
  includeInvalidated: true,
});
```

Every fact ever, whatever its state. `asOf` **overrides** `includeInvalidated`
when both are passed.

### A timeline for one fact

```ts
const { facts } = await memory.listFacts('user_42', {
  q: 'berlin',
  includeInvalidated: true,
});

facts
  .sort((a, b) => a.validAt.localeCompare(b.validAt))
  .forEach((f) => {
    console.log(
      `${f.validAt.slice(0, 10)}  ${f.predicate} ${f.object}` +
      (f.invalidAt ? `  (superseded ${f.invalidAt.slice(0, 10)})` : ''),
    );
  });
```

---

## Gotchas

**Future-dated facts.** `asOf` in the future returns facts whose `validAt` has
arrived by then but which we already know about — including a stated future
change. Correct, occasionally surprising.

**Timezones.** A bare date is midnight **UTC**. If your users are elsewhere,
build the instant explicitly rather than trusting a date string.

**`createdAt` vs `validAt`.** A fact stated today about the past has
`validAt` in the past but `createdAt` today. `asOf` before `createdAt` excludes
it — we did not know it yet, even though it was true. That is the point of
bi-temporality.

**Not free.** It is a database read with the same shape as normal recall. Cheaper
than normal recall, actually, since it skips the embedding call.

---

## Next

- [The bi-temporal model](/concepts/bi-temporal-model/) — the underlying design
- [Curating and correcting memory](/guides/curating-memory/)
- [Recall API](/api/recall/)

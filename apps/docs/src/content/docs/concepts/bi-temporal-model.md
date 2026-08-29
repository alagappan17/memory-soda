---
title: "The bi-temporal model"
description: "Every fact carries four timestamps, in two independent pairs. This is the design decision that makes Memory Soda more than a fact list, and the one most…"
---
Every fact carries four timestamps, in two independent pairs. This is the design
decision that makes Memory Soda more than a fact list, and the one most worth
understanding before you use `asOf`.

---

## The two timelines

```
VALID TIME   , when the fact is true in the world
                validAt ──────────────────► validUntil

BELIEF TIME  , when we believed it
                createdAt ────────────────► invalidAt
```

They move independently. A fact can stop being true without us noticing, and we
can stop believing something that was always false.

| Column | Answers |
|---|---|
| `validAt` | From when is this true? |
| `validUntil` | Until when is it true? `null` = open-ended. |
| `createdAt` | When did we record it? |
| `invalidAt` | When was it superseded or deleted? `null` = still believed. |

---

## The rule that keeps it coherent

> **`invalidAt` means *superseded or deleted*, only. It never means "stopped
> being true".**

An end of validity goes in `validUntil`. A change of belief goes in `invalidAt`.
Conflating them is the mistake that makes most fact stores unable to answer
historical questions.

```ts
// The user says: "I'm on a cut until December."
{ validAt: '2026-08-16', validUntil: '2026-12-01', invalidAt: null }
// Stops being live on 1 December, automatically. Nothing had to invalidate it.

// The user says: "I moved from Berlin to Lisbon."
// old fact:
{ object: 'berlin', validAt: '2026-03-01', validUntil: null, invalidAt: '2026-08-16' }
// new fact:
{ object: 'lisbon', validAt: '2026-08-16', validUntil: null, invalidAt: null }
// The Berlin fact was true and we believed it. Now we don't. `validUntil` stays null.
```

---

## Liveness

"Currently true" is one predicate, used by every read path:

```sql
invalid_at IS NULL
AND valid_at <= now()
AND (valid_until IS NULL OR valid_until > now())
```

Three ways a fact leaves the live set:

| | Cause |
|---|---|
| `invalidAt` set | A contradicting fact won, or you deleted it |
| `validUntil` passed | Its stated window ended, no write required |
| `validAt` in the future | Not true *yet* |

### Future-dated facts are invisible

"I start at Anthropic in September" is extracted, stored with
`validAt = 2026-09-01`, and **cannot be recalled until September**. This is
correct bi-temporal behaviour and surprising the first time you hit it.

To see them:

```ts
await memory.listFacts('user_42', { includeInvalidated: true });
```

---

## Point-in-time recall

`asOf` answers "what did we believe, about that moment, at that moment?"

```sql
created_at  <= $asOf              -- the row existed by then
AND valid_at    <= $asOf          -- and was in its validity window
AND (valid_until IS NULL OR valid_until > $asOf)
AND (invalid_at  IS NULL OR invalid_at  > $asOf)   -- and we still believed it
```

```ts
// What did we know in June?
const { context } = await memory.recall({
  dataset: 'user_42',
  asOf: '2026-06-01T00:00:00Z',
});
// → "- user lives in berlin"   (the Lisbon fact didn't exist yet)
```

Uses:

- **Auditing**, "why did the agent say that on 14 August?"
- **Debugging**, separate a retrieval bug from a memory that legitimately changed
- **Compliance**, reconstruct the state that drove a decision

> `asOf` **bypasses hybrid retrieval**. It falls back to keyword and recency
> ranking, because the vector/entity path assumes the current live set. Results
> are correct but ranked less well. See
> [Point-in-time recall](/guides/point-in-time-recall/).

---

## How valid time gets populated

Extraction sets `validFrom` / `validUntil` **only when the user states them
explicitly**. Defaulting both to `null` is deliberate, most facts are
open-ended, and invented bounds are worse than none.

| The user says | `validAt` | `validUntil` |
|---|---|---|
| "I like mango sticky rice" | now | `null` |
| "I've used Arch since 2019" | `2019-01-01` | `null` |
| "I'm on a cut until December" | now | that December |
| "I'll run daily for the next six months" | now | now + 6 months |
| "I used to work at Google" | now | *past*, inserted as history, never supersedes anything |

### Same-day coercion

`validFrom` is date-only, so "today" would resolve to midnight, *hours before*
facts recorded earlier the same day. A brand-new statement would look older than
the fact it supersedes, and the contradiction judge would keep the wrong one.

So: **a `validFrom` equal to today is coerced to `now`.**

---

## Contradiction versus coexistence

Not every difference is a contradiction. The judge is asked to decide, and
defaults to keeping both.

| Verdict | Meaning | Example |
|---|---|---|
| `old` | The new fact replaces the old | employer, home city, current phone |
| `new` | The new fact is wrong or adds nothing | a less precise restatement |
| `neither` | Both are true at once | multiple skills, hobbies, devices |

Exclusive states, one employer, one home city, supersede. Non-exclusive ones
accumulate. On genuine uncertainty the verdict is `neither`, because destroying
knowledge is worse than keeping a redundant row.

### Renewal

An expired-but-not-superseded fact (`validUntil` past, `invalidAt` still `null`)
still occupies the live-unique index. Re-stating the same claim stamps
`invalidAt` on the expired row so the new one can be inserted. "I'm cutting again
until March" works even though last year's cut is still on file.

---

## Worked example

```
2026-03-01  "I live in Berlin."
            → berlin   validAt 03-01  validUntil null  invalidAt null

2026-05-10  "I'm in Berlin until August, then Lisbon."
            → berlin   validAt 03-01  validUntil 08-01  invalidAt null      (updated window)
            → lisbon   validAt 08-01  validUntil null   invalidAt null      (future-dated)

2026-08-16  recall()
            → lisbon is live; berlin expired on its own, nothing invalidated it

2026-08-16  recall({ asOf: '2026-06-01' })
            → berlin, on 1 June that was both true and believed
```

---

## Next

- [Point-in-time recall](/guides/point-in-time-recall/), practical uses of `asOf`
- [The extraction pipeline](/concepts/extraction-pipeline/), where contradictions are judged

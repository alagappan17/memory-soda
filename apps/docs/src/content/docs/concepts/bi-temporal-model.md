---
title: 'The bi-temporal model'
description: 'Every fact carries four timestamps, in two independent pairs.'
---

Every fact carries four timestamps, in two independent pairs.

## The two timelines

```
VALID TIME   , when the fact is true in the world
                validAt ──────────────────► validUntil

BELIEF TIME  , when we believed it
                createdAt ────────────────► invalidAt
```

They move independently. A fact can stop being true without us noticing, and we
can stop believing something that was always false.

| Column       | Answers                                                     |
| ------------ | ----------------------------------------------------------- |
| `validAt`    | From when is this true?                                     |
| `validUntil` | Until when is it true? `null` = open-ended.                 |
| `createdAt`  | When did we record it?                                      |
| `invalidAt`  | When was it superseded or deleted? `null` = still believed. |

## The rule that keeps it coherent

> **`invalidAt` means _superseded or deleted_, only. It never means "stopped
> being true".**

An end of validity goes in `validUntil`. A change of belief goes in `invalidAt`.
Conflating them is the mistake that makes most fact stores unable to answer
historical questions.

```ts
// The user says: "I'm on a cut until December."
{ validAt: '2026-08-16', validUntil: '2026-12-01', invalidAt: null }
// Stops being live on 1 December, automatically. Nothing had to invalidate it.

// The user says: "I traded in my Honda Civic for a Tesla Model 3."
// old fact:
{ object: 'honda civic', validAt: '2026-03-01', validUntil: null, invalidAt: '2026-08-16' }
// new fact:
{ object: 'tesla model 3', validAt: '2026-08-16', validUntil: null, invalidAt: null }
// The Honda Civic fact was true and we believed it. Now we don't. `validUntil` stays null.
```

## Liveness

"Currently true" is one predicate, used by every read path:

```sql
invalid_at IS NULL
AND valid_at <= now()
AND (valid_until IS NULL OR valid_until > now())
```

Three ways a fact leaves the live set:

|                         | Cause                                       |
| ----------------------- | ------------------------------------------- |
| `invalidAt` set         | A contradicting fact won, or you deleted it |
| `validUntil` passed     | Its stated window ended, no write required  |
| `validAt` in the future | Not true _yet_                              |

### Future-dated facts are invisible

"I pick up my Model 3 in September" is extracted, stored with
`validAt = 2026-09-01`, and **cannot be recalled until September**. This is
correct bi-temporal behaviour and surprising the first time you hit it.

To see them:

```ts
await memory.listFacts('user_42', { includeInvalidated: true });
```

## Point-in-time recall

`asOf` answers "what did we believe, about that moment, at that moment?"

```ts
// What did we know in June?
const { context } = await memory.recall({
  dataset: 'user_42',
  asOf: '2026-06-01T00:00:00Z',
});
// → "- user drives honda civic"   (the Tesla Model 3 fact didn't exist yet)
```

> `asOf` **bypasses hybrid retrieval**. It falls back to keyword and recency
> ranking, because the vector/entity path assumes the current live set. Results
> are correct but ranked less well. See
> [Point-in-time recall](/guides/point-in-time-recall/).

## How valid time gets populated

Extraction sets `validFrom` / `validUntil` **only when the user states them
explicitly**. Most facts are open-ended, and invented bounds are worse than none.

| The user says                 | `validAt`    | `validUntil`                                           |
| ----------------------------- | ------------ | ------------------------------------------------------ |
| "I like Breaking Bad"         | now          | `null`                                                 |
| "I've used Arch since 2019"   | `2019-01-01` | `null`                                                 |
| "I'm on a cut until December" | now          | that December                                          |
| "I used to work at Google"    | now          | _past_, inserted as history, never supersedes anything |

### Same-day coercion

`validFrom` is date-only, so "today" would resolve to midnight, _hours before_
facts recorded earlier the same day, and the contradiction judge would keep the
wrong one. So: **a `validFrom` equal to today is coerced to `now`.**

## Contradiction versus coexistence

Not every difference is a contradiction. Exclusive states, one employer, one
home city, supersede (`old` verdict). Non-exclusive ones, skills, hobbies,
devices, accumulate (`neither`). On genuine uncertainty the verdict is
`neither`, because destroying knowledge is worse than keeping a redundant row.
See [the extraction pipeline](/concepts/extraction-pipeline/#step-4-contradiction-judging).

An expired-but-not-superseded fact still occupies the live-unique index;
re-stating the same claim stamps `invalidAt` on the expired row so the new one
can land. "I'm cutting again until March" works even though last year's cut is
still on file.

## Worked example

```
2026-03-01  "I drive a Honda Civic."
            → honda civic   validAt 03-01  validUntil null  invalidAt null

2026-08-16  "Actually I traded it in for a Tesla Model 3."
            → same predicate, different object: judged a contradiction
            → honda civic     invalidAt 08-16   (superseded)
            → tesla model 3   validAt 08-16  validUntil null  invalidAt null

2026-08-16  recall()
            → tesla model 3 is live

2026-08-16  recall({ asOf: '2026-06-01' })
            → honda civic, on 1 June that was both true and believed
```

Note what this is not: restating the exact same fact (same subject, predicate
and object) never reaches contradiction judging at all, it is dropped as a
duplicate before that step runs. Only a genuinely different statement, a
different object for the same predicate, gets judged.

## Next

- [Point-in-time recall](/guides/point-in-time-recall/), practical uses of `asOf`
- [The extraction pipeline](/concepts/extraction-pipeline/), where contradictions are judged

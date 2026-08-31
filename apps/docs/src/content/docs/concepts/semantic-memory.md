---
title: 'Semantic memory'
description: 'The durable store: what is true about a user, and when.'
---

The durable store: what is true about a user, and when. `recall()` reads it,
the dashboard's Datasets page shows it, and it is what makes an assistant feel
like it knows someone.

## Facts

A fact is a **subject–predicate–object triple** with a validity window.

```json
{
  "factId": "3a91…",
  "subject": "user",
  "predicate": "is interested in",
  "object": "toyota corolla hybrid",
  "objectIsEntity": true,
  "confidence": 0.9,
  "sourceQuote": "yeah the corola hybrid looks great",
  "validAt": "2026-08-16T09:14:02.000Z",
  "validUntil": null,
  "invalidAt": null,
  "episodeId": "8b21…"
}
```

`confidence` is the extraction model's self-rating, filtered at retrieval,
never at write. `sourceQuote` is a verbatim user quote, provenance. The
timestamp semantics are the
[bi-temporal model](/concepts/bi-temporal-model/); full field reference:
[Semantic memory API](/api/semantic-memory/).

### Two kinds in one table

```ts
// Relationship, object names an entity
{ subject: 'user', predicate: 'works at', object: 'anthropic', objectIsEntity: true }

// Literal, object is a value with no entity behind it
{ subject: 'user', predicate: 'wants a family car that is',
  object: 'hybrid, easy to park, under $30k', objectIsEntity: false }
```

Keeping both in one table is deliberate: it leaves multi-hop traversal possible
later (a recursive CTE over `objectIsEntity` rows) without a second store.

### "Live" facts

A fact is currently true when:

```sql
invalid_at IS NULL
AND valid_at <= now()
AND (valid_until IS NULL OR valid_until > now())
```

Two consequences worth knowing: a fact with a **future** `validAt` ("I pick up
my Model 3 in September") is stored but invisible until that date arrives, and
a fact whose `validUntil` has passed drops out automatically, without anything
having to invalidate it.

## Entities

The canonical nouns a user's facts hang off.

```json
{ "entityId": "c1f2…", "name": "toyota corolla hybrid", "type": "PRODUCT" }
```

Names are lower-cased and unique per `(dataset, project)`. Types:
`PERSON` · `ORG` · `PLACE` · `PRODUCT` · `SKILL` · `TOPIC` · `EVENT` · `FOOD` ·
`ROLE` · `CONCEPT` · `THING` · `DATE`. An unrecognised type falls back to
`THING`.

New entities are matched against existing ones by exact name, then nearest
same-type embedding neighbour (merge at `entityResolutionThreshold`, default
0.88), else inserted. This is what collapses typos and aliases: the user types
`corola hybrid`, extraction corrects it to the canonical
`toyota corolla hybrid`, and the memory doesn't silently split in two.
Type-awareness matters: `apple` the `ORG` never merges into `apple` the `FOOD`.

## The anchor

Every fact has an **anchor entity**, derived, never stored:

```
anchor = objectIsEntity ? object : subject
```

The anchor drives two things: how facts are **grouped** in the rendered context
block, and the entity-anchored [retrieval](/concepts/retrieval/) signal.

## Every fact is about the user

The extraction prompt's first rule, enforced deterministically in code: any
fact whose subject is not the literal string `user` is **discarded**.

```
✓ user · is interested in · asus rog
✗ asus rog · features · rtx 4070 gpu        ← spec the assistant supplied
✗ gaming laptop · is a type of · laptop     ← world knowledge
```

**Why:** without it, the model fills the store with encyclopedia content scraped
from its own answers, and retrieval quality collapses.

**The scope:** `user` means the dataset's subject, whoever speaks in the
`user` role of the conversation. A dataset usually maps to a person, which is
what Memory Soda is built and tuned for, but the partition is yours: point a
dataset at any subject that converses in the `user` role and it accumulates
memory the same way. What you cannot do is extract facts about both
participants, about third parties as subjects, or from `assistant`-role
statements.

Other entities appear freely as the **object** of a user fact, that is how
`asus rog` gets into the store at all.

## Reading facts

**For a prompt**, use [`recall()`](/api/recall/). **For inspection or a UI**,
use `listFacts()` / `listEntities()`, unranked and chronological, with keyword,
entity, `asOf` and `includeInvalidated` filters. Method reference:
[`memory.semantic`](/sdk/semantic-memory/).

## Writing facts

There is **no write API**. Facts are produced exclusively by the
[extraction pipeline](/concepts/extraction-pipeline/) running over messages you
append to a thread.

You can, however, **remove** one:

```ts
await memory.deleteFact('user_42', factId);
```

This is a soft delete, it stamps `invalidAt`, so the fact disappears from
retrieval but the history remains queryable with `asOf`. See
[Curating memory](/guides/curating-memory/).

## Next

- [The bi-temporal model](/concepts/bi-temporal-model/), why there are four timestamps
- [Retrieval](/concepts/retrieval/), how facts are found and ranked
- [The extraction pipeline](/concepts/extraction-pipeline/), how they are created

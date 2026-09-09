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

The extraction prompt is shown the dataset's existing entities (and its most
recent facts), so a later conversation's "my civic" comes back as the stored
`honda civic`, not a new `civic`. Names it still invents are matched against
existing ones by exact name, then nearest same-type embedding neighbour (merge
at `entityResolutionThreshold`, default 0.88), else inserted. This is what
collapses typos and aliases: the user types `corola hybrid`, extraction
corrects it to the canonical `toyota corolla hybrid`, and the memory doesn't
silently split in two. Type-awareness matters: `apple` the `ORG` never merges
into `apple` the `FOOD`. Embedding distance alone is not enough, which is why
the prompt sees the names: `honda civic` and `civic` sit about as far apart as
`honda civic` and `honda accord`.

## The anchor

Every fact has an **anchor entity**, derived, never stored:

```
anchor = objectIsEntity ? object : subject
```

The anchor drives two things: how facts are **grouped** in the rendered context
block, and the entity-anchored [retrieval](/concepts/retrieval/) signal.

## Every fact is about the user's world

The extraction prompt's first rule, enforced deterministically in code: a
fact's subject is `user`, or an entity the user is **linked to**, either by a
relationship in the same extraction or one already in the store. Anything
else is **discarded**.

```
✓ user · owns · honda civic
✓ honda civic · has mileage · about 120,000 km   ← the user said it about their car
✓ user · has sister · priya
✓ priya · works at · netflix                     ← the user said it about their sister
✗ honda civic · has · 1.5l turbo engine          ← spec the assistant supplied
✗ gaming laptop · is a type of · laptop          ← world knowledge
```

This is what makes memory a graph rather than a list: `user → owns → honda
civic → has mileage → 120,000 km` is two facts, two hops, and a query about
"my car's mileage" walks it through the entity anchor. Folding the second hop
into the first (`user has run 120,000 km on honda civic`) would store the same
words as a string that no entity can reach.

**Why the guard:** without it, the model fills the store with encyclopedia
content scraped from its own answers, and retrieval quality collapses. The
link requirement keeps the assistant's product knowledge out while letting the
user's own things and people in.

**The scope:** `user` means the dataset's subject, whoever speaks in the
`user` role of the conversation. A dataset usually maps to a person, which is
what Memory Soda is built and tuned for, but the partition is yours: point a
dataset at any subject that converses in the `user` role and it accumulates
memory the same way. What you cannot do is extract from `assistant`-role
statements, or store facts about an entity the user has never connected to
themselves.

**Ending a link.** When the user says a relationship ended ("I sold the
Civic last week"), the same triple comes back with a `validUntil` and the live
row is **closed**, not duplicated and not invalidated. If that was the user's
last live link to the entity, the facts anchored on it (its mileage, its
condition) are closed at the same instant: the car has left the user's world,
so a walk from `user` no longer reaches it and retrieval stops surfacing it as
current.

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

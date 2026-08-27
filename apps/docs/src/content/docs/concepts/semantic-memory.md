---
title: "Semantic memory"
description: "The durable store: what is true about a user, and when."
---
The durable store: what is true about a user, and when.

This is the layer you actually consume. `recall()` reads it, the dashboard's
Datasets page shows it, and it is what makes an assistant feel like it knows
someone.

---

## Facts

A fact is a **subject–predicate–object triple** with a validity window.

```json
{
  "factId": "3a91…",
  "subject": "user",
  "predicate": "is interested in",
  "object": "dji osmo pocket 3",
  "objectIsEntity": true,
  "confidence": 0.9,
  "sourceQuote": "yeah the pcoket 3 looks great",
  "validAt": "2026-08-16T09:14:02.000Z",
  "validUntil": null,
  "invalidAt": null,
  "episodeId": "8b21…"
}
```

| Field | Meaning |
|---|---|
| `subject` | **Always `"user"`.** Enforced in both the prompt and code — see [below](#every-fact-is-about-the-user). |
| `predicate` | A short present-tense verb phrase, lower-cased and punctuation-stripped. |
| `object` | An entity name, or a literal value. Capped at 500 characters. |
| `objectIsEntity` | Whether `object` names a row in `entities`. |
| `confidence` | The extraction model's self-rating, 0–1. Filtered at retrieval, never at write. |
| `sourceQuote` | A verbatim quote from the user supporting the claim. Provenance. |
| `validAt` / `validUntil` | When it is true **in the world**. |
| `invalidAt` | When it was **superseded or deleted**. Never "stopped being true". |
| `episodeId` | Which episode produced it. |

### Two kinds in one table

```ts
// Relationship — object names an entity
{ subject: 'user', predicate: 'works at', object: 'anthropic', objectIsEntity: true }

// Literal — object is a value with no entity behind it
{ subject: 'user', predicate: 'wants a travel camera that is',
  object: 'small, cinematic-looking, under $1000', objectIsEntity: false }
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

Every read path uses this predicate. Two consequences worth knowing:

- A fact with a **future** `validAt` ("I start at Anthropic in September") is
  stored but invisible until that date arrives.
- A fact whose `validUntil` has passed drops out automatically, without anything
  having to invalidate it.

---

## Entities

The canonical nouns a user's facts hang off.

```json
{ "entityId": "c1f2…", "name": "dji osmo pocket 3", "type": "PRODUCT" }
```

Names are lower-cased and unique per `(dataset, project)`.

### Types

`PERSON` · `ORG` · `PLACE` · `PRODUCT` · `SKILL` · `TOPIC` · `EVENT` · `FOOD` ·
`ROLE` · `CONCEPT` · `THING` · `DATE`

An unrecognised type falls back to `THING`.

### Resolution

New entities are matched against existing ones in three steps:

1. **Exact name match** → reuse.
2. **Nearest same-type neighbour** by embedding cosine similarity. Merge if
   `>= entityResolutionThreshold` (default `0.88`).
3. Otherwise **insert**.

Type-awareness matters: `apple` the `ORG` never merges into `apple` the `FOOD`.

This is what collapses typos and aliases. The user types `pcoket 3`; extraction
corrects it to the canonical `dji osmo pocket 3` discussed in the conversation,
and the memory doesn't silently split in two.

---

## The anchor

Every fact has an **anchor entity** — derived, never stored:

```
anchor = objectIsEntity ? object : subject
```

```
user · is interested in · dji osmo pocket 3   →  anchor: "dji osmo pocket 3"
user · wants a camera that is · small…        →  anchor: "user"
```

The anchor drives two things: how facts are **grouped** in the rendered context
block, and the entity-anchored [retrieval](/concepts/retrieval/) signal.

---

## Every fact is about the user

The extraction prompt's first rule, enforced deterministically in code:

```ts
const isAllowedSubject = (subject: string) =>
  subject.toLowerCase().trim() === 'user';
```

Any fact whose subject is not the literal string `user` is **discarded**.

```
✓ user · is interested in · asus rog
✗ asus rog · features · rtx 4070 gpu        ← spec the assistant supplied
✗ gaming laptop · is a type of · laptop     ← world knowledge
```

**Why:** without it, the model fills the store with encyclopedia content scraped
from its own answers, and retrieval quality collapses.

**The cost:** Memory Soda can only remember things about a *person*. Facts about
a project, a codebase, a task or an agent are architecturally impossible today.
If you need those, this is the constraint to know about before adopting.

Other entities appear freely as the **object** of a user fact — that is how
`asus rog` gets into the store at all.

---

## Storage

```
facts
  (dataset, project_id, invalid_at)          tenancy + liveness
  (dataset, project_id, subject)             anchor lookup
  (dataset, project_id, object)              anchor lookup
  (dataset, project_id, valid_at) WHERE invalid_at IS NULL     recency fallback
  UNIQUE (dataset, project_id, subject, predicate, object,
          coalesce(valid_until,'infinity')) WHERE invalid_at IS NULL
  ivfflat (embedding vector_cosine_ops)      vector search
  GIN to_tsvector(subject||predicate||object)  keyword search

entities
  UNIQUE (dataset, project_id, name)
  ivfflat (embedding vector_cosine_ops)
```

The partial unique index is the final backstop against duplicate live facts when
concurrent extraction jobs race. `valid_until` is part of the key so an expired
fact does not block re-asserting the same claim.

Fact embeddings are enriched with the anchor before embedding:

```
"user is interested in dji osmo pocket 3. About: dji osmo pocket 3."
```

which makes the anchor more prominent in vector space and measurably improves
entity-centric retrieval.

---

## Reading facts

**For a prompt** — use [`recall()`](/api/recall/):

```ts
const { context } = await memory.recall({ dataset: 'user_42', query: userMessage });
```

**For inspection or a UI** — use the fact list, which is unranked and
chronological:

```ts
const { facts, total } = await memory.listFacts('user_42', {
  q: 'camera',              // optional keyword filter
  limit: 50,                // 1–100
  includeInvalidated: true, // include superseded/deleted
  asOf: '2026-06-01',       // point-in-time
});

const entities = await memory.listEntities('user_42');
const { facts: entityFacts } = await memory.listFacts('user_42', { entity: 'berlin' });
```

---

## Writing facts

There is **no write API**. Facts are produced exclusively by the
[extraction pipeline](/concepts/extraction-pipeline/) running over messages you append
to a thread.

You can, however, **remove** one:

```ts
await memory.deleteFact('user_42', factId);
```

This is a soft delete — it stamps `invalidAt`, so the fact disappears from
retrieval but the history remains queryable with `asOf`. See
[Curating memory](/guides/curating-memory/).

---

## Next

- [The bi-temporal model](/concepts/bi-temporal-model/) — why there are four timestamps
- [Retrieval](/concepts/retrieval/) — how facts are found and ranked
- [The extraction pipeline](/concepts/extraction-pipeline/) — how they are created

---
title: "Facts and entities"
description: "Reading and curating the durable fact store."
---
Reading and curating the durable fact store.

For prompts, use [`recall()`](/sdk/client/#recall), it ranks and renders. These
methods are for inspection, admin UIs and correction: unranked, chronological,
structured.

```ts
const { facts } = await memory.listFacts('user_42');
```

---

## `listFacts()`

```ts
listFacts(dataset: string, opts?: {
  q?: string;
  limit?: number;
  includeInvalidated?: boolean;
  asOf?: string | Date;
}): Promise<SemanticFactsResponse>
```

| Option | Default | Notes |
|---|---|---|
| `q` |, | Keyword (full-text) filter over subject + predicate + object |
| `limit` | `50` | 1–100 |
| `includeInvalidated` | `false` | Include superseded and soft-deleted facts |
| `asOf` |, | Point-in-time. **Overrides `includeInvalidated`.** |

```ts
const { facts, total } = await memory.listFacts('user_42', {
  q: 'car',
  limit: 20,
});
```

```json
{
  "facts": [
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
  ],
  "total": 17
}
```

Ordered by `validAt` descending. No `relevanceScore`, these are not ranked.
`total` is the count matching the filter, ignoring `limit`.

### Showing history

```ts
const { facts } = await memory.listFacts('user_42', {
  includeInvalidated: true,
});

for (const f of facts) {
  const state = f.invalidAt ? 'superseded'
    : f.validUntil && new Date(f.validUntil) < new Date() ? 'expired'
    : 'current';
  console.log(`[${state}] ${f.subject} ${f.predicate} ${f.object}`);
}
```

See [The bi-temporal model](/concepts/bi-temporal-model/) for what those
states mean.

---

## `deleteFact()`

```ts
deleteFact(dataset: string, factId: string): Promise<{ factId: string; deleted: boolean }>
```

```ts
await memory.deleteFact('user_42', '3a91…');
// { factId: '3a91…', deleted: true }
```

A **soft delete**, stamps `invalidAt`. The fact leaves retrieval immediately but
stays queryable via `includeInvalidated` and `asOf`.

Throws `ApiError` with `status: 404` if the fact does not exist, belongs to
another dataset, or is already invalidated.

> This is the **only write operation** in the whole SDK. Facts cannot be created
> or edited directly, see [Curating memory](/guides/curating-memory/) for
> how to correct something.

---

## `listEntities()`

```ts
listEntities(dataset: string): Promise<SemanticEntity[]>
```

```ts
const entities = await memory.listEntities('user_42');
// [{ entityId: 'c1f2…', name: 'toyota corolla hybrid', type: 'PRODUCT' }, …]
```

Ordered by `updatedAt` descending, most recently mentioned first.

> **Unpaginated.** Returns every entity for the dataset. Fine at normal sizes;
> keep it off hot paths.

Types: `PERSON` `ORG` `PLACE` `PRODUCT` `SKILL` `TOPIC` `EVENT` `FOOD` `ROLE`
`CONCEPT` `THING` `DATE`.

---

## Facts for one entity

Pass `entity` to [`listFacts()`](#listfacts) for every live fact touching a named entity,
as subject **or** object:

```ts
const { facts } = await memory.listFacts('user_42', { entity: 'honda civic' });
```

The name is lower-cased on the way out, so `'Honda Civic'` and `'honda civic'` both work.
Names must otherwise match exactly, this is a lookup, not a search. Get valid
names from `listEntities()`.

Returns `[]` for an unknown entity rather than throwing. `entity` takes
precedence over the other filters.

### Grouping a profile by entity

```ts
const entities = await memory.listEntities('user_42');

const profile = await Promise.all(
  entities.map(async (e) => ({
    entity: e,
    facts: (await memory.listFacts('user_42', { entity: e.name })).facts,
  })),
);
```

One request per entity, fine for a dashboard, not for a request path.

---

## Building an admin view

```ts
async function memoryProfile(dataset: string) {
  const [{ facts, total }, entities] = await Promise.all([
    memory.listFacts(dataset, { limit: 100, includeInvalidated: true }),
    memory.listEntities(dataset),
  ]);

  const now = Date.now();
  return {
    total,
    entities,
    current: facts.filter((f) => !f.invalidAt && (!f.validUntil || new Date(f.validUntil).getTime() > now)),
    superseded: facts.filter((f) => f.invalidAt),
    expired: facts.filter((f) => !f.invalidAt && f.validUntil && new Date(f.validUntil).getTime() <= now),
  };
}
```

---

## Not available

| | Status |
|---|---|
| Create a fact | No write API. Facts are derived from messages only. |
| Edit a fact | Delete and let extraction re-derive. |
| Pin a fact | No immutability flag, anything can be superseded. |
| Bulk delete a dataset | No endpoint. See [Privacy and data deletion](/operations/privacy-and-deletion/). |
| Paginate entities | `listEntities` returns everything. |
| Keyword + entity together | `entity` wins; the other filters are ignored. |

---

## Next

- [Curating and correcting memory](/guides/curating-memory/)
- [Semantic memory](/concepts/semantic-memory/), the concepts
- [Type reference](/sdk/types/)

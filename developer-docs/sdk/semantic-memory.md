# `client.semantic`

Reading and curating the durable fact store.

For prompts, use [`recall()`](./client.md#recall) — it ranks and renders. These
methods are for inspection, admin UIs and correction: unranked, chronological,
structured.

```ts
const { facts } = await memory.semantic.listFacts('user_42');
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
| `q` | — | Keyword (full-text) filter over subject + predicate + object |
| `limit` | `50` | 1–100 |
| `includeInvalidated` | `false` | Include superseded and soft-deleted facts |
| `asOf` | — | Point-in-time. **Overrides `includeInvalidated`.** |

```ts
const { facts, total } = await memory.semantic.listFacts('user_42', {
  q: 'camera',
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
      "object": "dji osmo pocket 3",
      "objectIsEntity": true,
      "confidence": 0.9,
      "sourceQuote": "yeah the pcoket 3 looks great",
      "validAt": "2026-08-16T09:14:02.000Z",
      "validUntil": null,
      "invalidAt": null,
      "episodeId": "8b21…"
    }
  ],
  "total": 17
}
```

Ordered by `validAt` descending. No `relevanceScore` — these are not ranked.
`total` is the count matching the filter, ignoring `limit`.

### Showing history

```ts
const { facts } = await memory.semantic.listFacts('user_42', {
  includeInvalidated: true,
});

for (const f of facts) {
  const state = f.invalidAt ? 'superseded'
    : f.validUntil && new Date(f.validUntil) < new Date() ? 'expired'
    : 'current';
  console.log(`[${state}] ${f.subject} ${f.predicate} ${f.object}`);
}
```

See [The bi-temporal model](../concepts/bi-temporal-model.md) for what those
states mean.

---

## `searchFacts()`

```ts
searchFacts(dataset: string, q: string, opts?: { limit?: number }): Promise<SemanticFactsResponse>
```

A one-line alias:

```ts
memory.semantic.searchFacts('user_42', 'camera', { limit: 10 });
// identical to
memory.semantic.listFacts('user_42', { q: 'camera', limit: 10 });
```

Keyword only — no vector search, no ranking. For semantic search use
[`recall()`](./client.md#recall).

---

## `deleteFact()`

```ts
deleteFact(dataset: string, factId: string): Promise<{ factId: string; deleted: boolean }>
```

```ts
await memory.semantic.deleteFact('user_42', '3a91…');
// { factId: '3a91…', deleted: true }
```

A **soft delete** — stamps `invalidAt`. The fact leaves retrieval immediately but
stays queryable via `includeInvalidated` and `asOf`.

Throws `ApiError` with `status: 404` if the fact does not exist, belongs to
another dataset, or is already invalidated.

> This is the **only write operation** in the whole SDK. Facts cannot be created
> or edited directly — see [Curating memory](../guides/curating-memory.md) for
> how to correct something.

---

## `listEntities()`

```ts
listEntities(dataset: string): Promise<SemanticEntity[]>
```

```ts
const entities = await memory.semantic.listEntities('user_42');
// [{ entityId: 'c1f2…', name: 'dji osmo pocket 3', type: 'PRODUCT' }, …]
```

Ordered by `updatedAt` descending — most recently mentioned first.

> **Unpaginated.** Returns every entity for the dataset. Fine at normal sizes;
> keep it off hot paths.

Types: `PERSON` `ORG` `PLACE` `PRODUCT` `SKILL` `TOPIC` `EVENT` `FOOD` `ROLE`
`CONCEPT` `THING` `DATE`.

---

## `listEntityFacts()`

Every live fact touching a named entity, as subject **or** object.

```ts
listEntityFacts(dataset: string, name: string): Promise<SemanticFact[]>
```

```ts
const facts = await memory.semantic.listEntityFacts('user_42', 'berlin');
```

The name is lower-cased server-side, so `'Berlin'` and `'berlin'` both work.
Names must otherwise match exactly — this is a lookup, not a search. Get valid
names from `listEntities()`.

Returns `[]` for an unknown entity rather than throwing.

### Grouping a profile by entity

```ts
const entities = await memory.semantic.listEntities('user_42');

const profile = await Promise.all(
  entities.map(async (e) => ({
    entity: e,
    facts: await memory.semantic.listEntityFacts('user_42', e.name),
  })),
);
```

One request per entity — fine for a dashboard, not for a request path.

---

## Building an admin view

```ts
async function memoryProfile(dataset: string) {
  const [{ facts, total }, entities] = await Promise.all([
    memory.semantic.listFacts(dataset, { limit: 100, includeInvalidated: true }),
    memory.semantic.listEntities(dataset),
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
| Pin a fact | No immutability flag — anything can be superseded. |
| Bulk delete a dataset | No endpoint. See [Privacy and data deletion](../operations/privacy-and-deletion.md). |
| Paginate entities | `listEntities` returns everything. |

---

## Next

- [Curating and correcting memory](../guides/curating-memory.md)
- [Semantic memory](../concepts/semantic-memory.md) — the concepts
- [Type reference](./types.md)

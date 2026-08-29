---
title: "Semantic memory API"
description: "Base path: /v1/memory/semantic · Auth: API key"
---
Base path: `/v1/memory/semantic` · Auth: [API key](/api/authentication/)

Unranked, chronological reads over the fact store, plus soft deletion. For
prompt-ready ranked output use [`POST /v1/memory/recall`](/api/recall/).

SDK equivalent: [`memory.facts`](/sdk/semantic-memory/)

> `:dataset` is a path segment. **Percent-encode it** if it can contain `/`,
> `?`, `#` or spaces.

---

## `GET /v1/memory/semantic/datasets/:dataset/facts`

### Query

| Param | Type | Default | Notes |
|---|---|---|---|
| `q` | string |, | Full-text filter over subject + predicate + object. Max 1000 chars. |
| `limit` | integer | `50` | 1–100 |
| `includeInvalidated` | boolean | `false` | Include superseded and soft-deleted |
| `asOf` | date |, | Point-in-time. **Overrides `includeInvalidated`.** |
| `episodeId` | uuid |, | Only facts extracted from this episode |

### Response `200`

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

### Examples

```bash
# Current facts
curl "http://localhost:3004/v1/memory/semantic/datasets/user_42/facts" \
  -H "Authorization: Bearer $KEY"

# Keyword filter
curl "http://localhost:3004/v1/memory/semantic/datasets/user_42/facts?q=car&limit=20" \
  -H "Authorization: Bearer $KEY"

# Full history, including superseded
curl "http://localhost:3004/v1/memory/semantic/datasets/user_42/facts?includeInvalidated=true" \
  -H "Authorization: Bearer $KEY"

# What did we believe on 1 June?
curl "http://localhost:3004/v1/memory/semantic/datasets/user_42/facts?asOf=2026-06-01" \
  -H "Authorization: Bearer $KEY"

# Provenance, everything one episode produced
curl "http://localhost:3004/v1/memory/semantic/datasets/user_42/facts?episodeId=8b21…" \
  -H "Authorization: Bearer $KEY"
```

> `episodeId` is available here but **not** exposed on the SDK's `listFacts()`.

---

## `DELETE /v1/memory/semantic/datasets/:dataset/facts/:factId`

Soft delete, stamps `invalidAt`.

### Response `200`

```json
{ "factId": "3a91…", "deleted": true }
```

The fact leaves retrieval immediately but stays queryable via
`includeInvalidated=true` and `asOf`. Nothing is physically removed.

### Errors

| Code | Body | Cause |
|---|---|---|
| `404` | `{ "error": "Fact not found" }` | Unknown id, wrong dataset, or already invalidated |

```bash
curl -X DELETE "http://localhost:3004/v1/memory/semantic/datasets/user_42/facts/3a91…" \
  -H "Authorization: Bearer $KEY"
```

> **This is the only write operation on `/v1`.** Facts cannot be created or
> edited, see [Curating memory](/guides/curating-memory/).

---

## `GET /v1/memory/semantic/datasets/:dataset/entities`

### Response `200`

```json
{
  "entities": [
    { "entityId": "c1f2…", "name": "toyota corolla hybrid", "type": "PRODUCT" },
    { "entityId": "d4a7…", "name": "honda civic", "type": "PRODUCT" },
    { "entityId": "e9b3…", "name": "user", "type": "PERSON" }
  ]
}
```

Ordered by `updatedAt` descending, most recently mentioned first.

> **Unpaginated.** Returns every entity for the dataset.

Types: `PERSON` `ORG` `PLACE` `PRODUCT` `SKILL` `TOPIC` `EVENT` `FOOD` `ROLE`
`CONCEPT` `THING` `DATE`.

---

## `GET /v1/memory/semantic/datasets/:dataset/entities/:name/facts`

Every **live** fact touching a named entity, as subject or object.

### Response `200`

```json
{
  "facts": [
    { "factId": "3a91…", "subject": "user", "predicate": "is interested in",
      "object": "toyota corolla hybrid", "objectIsEntity": true, "confidence": 0.9,
      "sourceQuote": "…", "validAt": "…", "validUntil": null,
      "invalidAt": null, "episodeId": "8b21…" }
  ]
}
```

The name is lower-cased server-side, so `Honda Civic` and `honda civic` both work.
Otherwise it must match exactly, this is a lookup, not a search. An unknown
entity returns `{ "facts": [] }`, not `404`.

Superseded and expired facts are excluded; there is no `includeInvalidated` here.

```bash
curl "http://localhost:3004/v1/memory/semantic/datasets/user_42/entities/honda civic/facts" \
  -H "Authorization: Bearer $KEY"
```

Percent-encode names containing spaces:

```bash
curl "http://localhost:3004/v1/memory/semantic/datasets/user_42/entities/toyota%20corolla%20hybrid/facts" \
  -H "Authorization: Bearer $KEY"
```

---

## Fact states

A fact is in exactly one state at any time:

| State | Condition |
|---|---|
| **live** | `invalidAt` null, `validAt <= now`, `validUntil` null or future |
| **superseded** | `invalidAt` set, a contradiction won, or you deleted it |
| **expired** | `invalidAt` null but `validUntil` in the past |
| **future** | `validAt` in the future, stored but not yet true |

Only **live** facts appear in `recall()` and in entity-facts. `includeInvalidated`
and `asOf` reach the rest.

See [The bi-temporal model](/concepts/bi-temporal-model/).

---

## Not available

| Operation | Status |
|---|---|
| Create a fact | No write API |
| Edit a fact | Delete and let extraction re-derive |
| Pin / protect a fact | No immutability flag |
| Bulk delete a dataset | No endpoint, see [Privacy and data deletion](/operations/privacy-and-deletion/) |
| Paginate entities | Returns everything |
| Delete an entity | No endpoint |

---

## Next

- [Recall API](/api/recall/), ranked, prompt-ready reads
- [Curating and correcting memory](/guides/curating-memory/)
- [Semantic memory](/concepts/semantic-memory/)

# Retrieval

How `recall()` decides which facts you get.

Three independent signals run in parallel and are fused by rank. No single
similarity score decides anything.

---

## The pipeline

```
query ──► embed once (768-dim)
            │
   ┌────────┼────────────────────────────────┐
   ▼        ▼                                ▼
 VECTOR   ENTITY ANCHOR                    KEYWORD
 cosine   entities named in the query,     postgres full-text over
 over     plus the query's nearest         subject + predicate + object
 facts    entities by embedding;           
          then every live fact touching them
   │        │                                │
   └────────┴────────────┬───────────────────┘
                         ▼
           Reciprocal Rank Fusion (k = 60)
                         ▼
              top `factsInContext` (default 8)
                         ▼
              group by anchor entity
                         ▼
                 render to text
```

Each signal scans `max(limit × 4, 20)` candidates.

---

## Signal 1 — vector

Plain cosine similarity over `facts.embedding`, ordered ascending by distance.

Fact embeddings are enriched with their anchor before embedding:

```
"user is interested in dji osmo pocket 3. About: dji osmo pocket 3."
```

This makes the anchor prominent in vector space and measurably improves
entity-centric retrieval over embedding the bare triple.

Skipped when the query embedding is unavailable — a failed embedding call
degrades to keyword and recency rather than failing the request.

---

## Signal 2 — entity anchor

**The reliability net**, and the least conventional part of the design.

Two ways an entity becomes an anchor for a query:

1. **Named in the query text.** A word-boundary regex match, so `art` cannot
   fire inside `start`.
2. **Semantically near the query.** The top `anchorVectorTopK` (default 3)
   entities whose embedding similarity to the query is at least
   `anchorVectorMin` (default 0.75).

Then *every live fact touching those names* — as subject or object — is pulled
in.

### Why it matters

```
query:  "I'm planning a trip to Thailand"

vector  → nothing. "mango sticky rice" is not semantically near "trip to Thailand".
keyword → nothing. No shared terms.
anchor  → "thailand" is an entity in this user's graph
        → every fact touching it, including
          "user tried mango sticky rice in thailand"
        → which surfaces "user's favourite dessert is mango sticky rice"
```

Pure vector search cannot bridge that gap. The anchor signal is what makes
memory feel like it *knows* someone rather than pattern-matching their words.

> **Known issue.** The anchor query has no `ORDER BY`, so the ranks it
> contributes to fusion reflect physical row order rather than relevance. The set
> of facts it surfaces is correct; their ordering within that set is arbitrary.

---

## Signal 3 — keyword

Postgres full-text search:

```sql
to_tsvector('english', subject || ' ' || predicate || ' ' || object)
  @@ plainto_tsquery('english', $query)
ORDER BY ts_rank(…) DESC
```

Backed by a GIN index. Catches exact terms — product names, place names, numbers
— that embeddings blur.

> The index expression and the query expression must stay byte-identical or the
> planner silently stops using the index.

---

## Fusion

**Reciprocal Rank Fusion** over the three ranked lists:

```
score(fact) = Σ  1 / (k + rank_in_list)        k = 60
           lists
```

RRF uses only **position**, never raw scores. That is the point: cosine
similarity, `ts_rank` and "touches an anchor entity" are not on comparable
scales, and normalising them would require calibration that does not survive a
change of embedding model.

A fact appearing in two lists at middling rank beats one appearing in a single
list at rank 1. Agreement across signals wins.

---

## Filters applied first

Before ranking, candidates must satisfy:

| Filter | Source |
|---|---|
| `dataset` and `projectId` | the request and your API key |
| liveness | `invalid_at IS NULL AND valid_at <= now() AND (valid_until IS NULL OR valid_until > now())` |
| `confidence >= minConfidence` | request override, else `retrievalMinConfidence` (default 0.5) |

---

## No query

`recall()` without a `query` skips all three signals and returns the most recent
live facts by `validAt`, each with `relevanceScore: 1`.

Right for a session opener — "what do I know about this person" — where there is
no message to be relevant to yet.

```ts
const { context } = await memory.recall({ dataset: 'user_42' });
```

---

## Grouping and rendering

Surviving facts are grouped by [anchor entity](./semantic-memory.md#the-anchor),
each group ordered by its best fact, then rendered:

```
Known facts about the user, most relevant first.

# FACTS  (format: fact (valid: from – to))
- user is interested in dji osmo pocket 3  (valid: 2026-08-16 – present)
- user finds too bulky mirrorless cameras  (valid: 2026-08-16 – present)
- user lives in berlin  (valid: 2026-03-01 – present)

# ENTITIES
- dji osmo pocket 3 (PRODUCT)
- mirrorless cameras (PRODUCT)
- berlin (PLACE)
```

Rendering is **deterministic** — no LLM on the read path. Fact text is collapsed
to a single line so it cannot break out of the block.

`context` is `""` when nothing matched. Always guard for it.

> `sourceQuote` and `confidence` are stored but **not rendered**. If you need
> provenance in a UI, request `include: ['raw']` and read the structured facts.

---

## Optional extras

```ts
await memory.recall({
  dataset: 'user_42',
  query: userMessage,
  include: ['episodes', 'synthesis', 'raw'],
});
```

| `include` | Adds | Cost |
|---|---|---|
| `episodes` | `episodes` — cross-thread summaries | one vector search |
| `synthesis` | `synthesis` — an LLM prose summary of the block | **one LLM call, 1–3 s** |
| `raw` | `facts[]` and `groups[]` — structured, with scores and quotes | free |

`synthesis` is the only thing that puts a model call on the read path. Use it
when a paragraph reads better than a bullet list, and measure the latency first.

---

## Tuning

| Setting | Default | Effect |
|---|---|---|
| `factsInContext` | 8 | Facts in the block. The main quality/token dial. |
| `retrievalMinConfidence` | 0.5 | Confidence floor. Raise to reduce noise, lower to recall more. |
| `anchorVectorMin` | 0.75 | How close an entity must be to anchor. Lower = broader. |
| `anchorVectorTopK` | 3 | How many vector-matched anchors to admit. |

Per-call overrides:

```ts
await memory.recall({
  dataset: 'user_42',
  query: userMessage,
  limit: 15,
  minConfidence: 0.7,
});
```

See [Tuning retrieval quality](../guides/tuning-retrieval.md).

---

## Performance

| Step | Typical |
|---|---|
| embed the query | 150–400 ms |
| three signals (parallel) | 20–80 ms |
| entity lookup for rendering | 10–30 ms |
| **total** | **200–500 ms** |
| with `synthesis` | 1.5–3.5 s |

The embedding round trip dominates. If you already have an embedding of the
user's message, there is currently no way to pass it in — every `recall()`
embeds again.

---

## Next

- [Tuning retrieval quality](../guides/tuning-retrieval.md)
- [Recall API](../api/recall.md) — full request and response reference

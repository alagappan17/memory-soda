---
title: 'Retrieval'
description: 'How recall() decides which facts you get.'
---

Three independent signals run in parallel and are fused by rank. No single
similarity score decides anything.

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

Before ranking, candidates must be live, in your `(dataset, project)`, and at
or above the confidence floor (`retrievalMinConfidence`, default 0.5).

## Signal 1, vector

Cosine similarity over `facts.embedding`. Fact embeddings are enriched with
their anchor before embedding:

```
"user is interested in toyota corolla hybrid. About: toyota corolla hybrid."
```

This makes the anchor prominent in vector space and measurably improves
entity-centric retrieval over embedding the bare triple.

A failed embedding call degrades to keyword and recency rather than failing the
request.

## Signal 2, entity anchor

**The reliability net**, and the least conventional part of the design.

Two ways an entity becomes an anchor for a query:

1. **Named in the query text.** A word-boundary regex match, so `art` cannot
   fire inside `start`.
2. **Semantically near the query.** The top `anchorVectorTopK` (default 3)
   entities whose embedding similarity to the query is at least
   `anchorVectorMin` (default 0.75).

Then _every live fact touching those names_, as subject or object, is pulled in.

```
query:  "anything good on Netflix tonight?"

vector  → nothing. "breaking bad" is not semantically near "anything on Netflix".
keyword → nothing. No shared terms.
anchor  → "netflix" is an entity in this user's graph
        → every fact touching it, including
          "user watches breaking bad on netflix"
        → which surfaces "user's favourite show is breaking bad"
```

Pure vector search cannot bridge that gap. The anchor signal is what makes
memory feel like it _knows_ someone rather than pattern-matching their words.

> **Known issue.** The anchor query has no `ORDER BY`, so the ranks it
> contributes to fusion reflect physical row order rather than relevance. The set
> of facts it surfaces is correct; their ordering within that set is arbitrary.

## Signal 3, keyword

Postgres full-text search over `subject || predicate || object`, backed by a
GIN index. Catches exact terms, product names, place names, numbers that
embeddings blur.

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

## No query

`recall()` without a `query` skips all three signals and returns the most recent
live facts by `validAt`. Right for a session opener, "what do I know about this
person", where there is no message to be relevant to yet.

## Grouping and rendering

Surviving facts are grouped by [anchor entity](/concepts/semantic-memory/#the-anchor),
each group ordered by its best fact, then rendered:

```
Known facts about the user, most relevant first.

# FACTS  (format: fact (valid: from – to))
- user is interested in toyota corolla hybrid  (valid: 2026-08-16 – present)
- user finds too big suvs  (valid: 2026-08-16 – present)
- user drives honda civic  (valid: 2026-03-01 – present)

# ENTITIES
- toyota corolla hybrid (PRODUCT)
- suvs (PRODUCT)
- honda civic (PRODUCT)
```

Rendering is **deterministic**, no LLM on the read path. Fact text is collapsed
to a single line so it cannot break out of the block.

`context` is `""` when nothing matched. Always guard for it.

> `sourceQuote` and `confidence` are stored but **not rendered**. If you need
> provenance in a UI, request `include: ['raw']` and read the structured facts.

## Optional extras

`include: ['episodes']` adds cross-thread summaries (one vector search).
`include: ['raw']` adds structured facts with scores and quotes (free).
`include: ['synthesis']` adds an LLM prose summary, **the only thing that puts
a model call on the read path, 1–3 s**; measure the latency before adopting it.
Full request/response shapes: [Recall API](/api/recall/).

## Performance

The embedding round trip dominates: 150–400 ms of a 200–500 ms total. If you
already have an embedding of the user's message, there is currently no way to
pass it in, every `recall()` embeds again.

## Next

- [Tuning retrieval quality](/guides/tuning-retrieval/), the settings and how to move them
- [Recall API](/api/recall/), full request and response reference

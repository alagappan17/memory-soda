---
title: "Tuning retrieval quality"
description: "How to change retrieval settings without making things quietly worse."
---
How to change retrieval settings without making things quietly worse.

---

## Method first

Most tuning goes wrong because it is done blind. Before changing anything:

1. **Build a fixture.** One dataset with a realistic profile — 15–30 facts across
   several entities. A throwaway `dataset` in the
   [Playground](/dashboard/playground/) is ideal.
2. **Write down the queries you care about**, with the facts you expect back.
3. **Record the baseline.** Run each query, save the `context`.
4. **Change one setting.**
5. **Re-run and diff.**

```ts
const QUERIES = [
  { q: 'what camera should I recommend?', expect: ['dji osmo pocket 3', 'under $1000'] },
  { q: 'where should we meet?',            expect: ['berlin'] },
  { q: 'what should I cook?',              expect: ['vegetarian', 'peanut'] },
];

async function evaluate(dataset: string) {
  const rows = [];
  for (const { q, expect } of QUERIES) {
    const { context, factCount } = await memory.recall({ dataset, query: q });
    const hits = expect.filter((e) => context.toLowerCase().includes(e));
    rows.push({ q, factCount, recall: `${hits.length}/${expect.length}`, missing: expect.filter((e) => !hits.includes(e)) });
  }
  console.table(rows);
}
```

Thirty lines, and it turns tuning from guesswork into arithmetic.

---

## Start here

Two settings account for most of the achievable improvement.

### `factsInContext` (default 8)

How many facts land in the block.

| Value | Effect |
|---|---|
| `4` | Tight and cheap. Misses relevant context on rich profiles |
| `8` | Sensible middle |
| `15–20` | Better recall; more tokens; more chance of irrelevant facts distracting the model |

Facts are short — twenty of them is still only a few hundred tokens. **Raising
this is usually the first thing to try**, and usually safe.

```ts
await memory.recall({ dataset, query, limit: 20 });   // per-call override
```

### `retrievalMinConfidence` (default 0.5)

The floor on the extraction model's self-rated confidence.

| Value | Effect |
|---|---|
| `0.3` | Recalls weak inferences — noisier, more complete |
| `0.5` | Drops the model's own low-confidence guesses |
| `0.8` | Only explicitly stated facts. Safe but forgetful |

> Confidence is **self-reported and poorly calibrated**. Treat it as a coarse
> filter, not a probability.

It also gates **invalidation** — a fact below the floor can never supersede an
existing one. Raising it makes memory more conservative in both directions:
fewer facts recalled, and fewer corrections applied.

---

## Symptom → setting

| Symptom | Try |
|---|---|
| Relevant facts exist but aren't recalled | Raise `factsInContext`; lower `retrievalMinConfidence` |
| Irrelevant facts crowd the block | Lower `factsInContext`; raise `retrievalMinConfidence` |
| Query mentions an entity but its facts don't surface | Lower `anchorVectorMin`; raise `anchorVectorTopK` |
| Two entities that should be one | Lower `entityResolutionThreshold` — **for future writes only** |
| One entity that should be two | Raise `entityResolutionThreshold` — existing merges stand |
| Near-duplicate facts accumulating | Lower `factDedupThreshold` |
| Contradictions not being caught | Lower `contradictionBandMin` |
| Facts wrongly superseding each other | Raise `contradictionBandMin` |

---

## The anchor settings

The [entity-anchor signal](/concepts/retrieval/#signal-2--entity-anchor) is
what surfaces facts with no lexical or semantic bridge to the query. When recall
feels shallow, this is usually why.

| Setting | Default | |
|---|---|---|
| `anchorVectorMin` | `0.75` | Minimum query↔entity similarity to become an anchor |
| `anchorVectorTopK` | `3` | How many vector-matched anchors to admit |

```
anchorVectorMin 0.75   "trip to thailand" → thailand ✓   food ✗
anchorVectorMin 0.60   "trip to thailand" → thailand ✓   food ✓   travel ✓
```

Lowering admits more anchors, which pulls in every fact touching them — powerful,
and quick to flood the block with tangential material. Move it in steps of `0.05`
and watch what appears.

> **Known issue.** The anchor query has no `ORDER BY`, so the ranks it feeds into
> fusion reflect physical row order, not relevance. The *set* of facts it
> surfaces is right; their ordering within that set is arbitrary. Raising
> `factsInContext` is a partial workaround.

---

## The write-path settings

These change **how facts are stored** and are not retroactive. Get them wrong and
you corrupt data rather than just degrade a query.

### `entityResolutionThreshold` (0.88)

Cosine above which two same-type entities merge.

| | |
|---|---|
| Too high | `dji osmo pocket 3` and `pocket 3` stay separate. A user's memory splits across two anchors |
| Too low | Genuinely distinct entities collapse into one. **Irreversible** |

Merging happens at write time. Lowering it does not merge existing entities, and
raising it does not un-merge them.

Check the [Entities](/dashboard/datasets/) tab for near-duplicates before
touching this.

### `factDedupThreshold` (0.95)

Cosine above which a new fact is treated as a duplicate.

It also sets the **top of the contradiction band**:

```
contradiction band = [contradictionBandMin, factDedupThreshold)
                   = [0.80, 0.95)
```

So lowering `factDedupThreshold` to `0.90` both widens deduplication **and
narrows** the contradiction band to `[0.80, 0.90)`. Fewer duplicates, fewer
contradictions caught. These two settings are not independent.

### `contradictionBandMin` (0.80)

Lower bound of that band. Facts in it are sent to the LLM judge even when their
predicates differ — this is what catches `works at` vs `is employed by`.

| | |
|---|---|
| Lower | More pairs judged. More LLM cost, more supersession, more risk of wrongly discarding a fact |
| Higher | Fewer pairs judged. Contradictions accumulate as coexisting facts |

---

## Episodic settings

| Setting | Default | |
|---|---|---|
| `contextEpisodes` | `3` | Episodes returned with `include: ['episodes']` |
| `similarityWeight` | `0.7` | Weight on vector similarity |
| `recencyWeight` | `0.3` | Weight on recency |

```
relevance = similarity × similarityWeight + 1/(1 + daysSince) × recencyWeight
```

The weights are **not normalised** — they are used as given. `0.7/0.3` favours
topical match; `0.4/0.6` favours "what did we talk about lately".

### `autoEpisodeIntervalMs` (10000) — the cost lever

Each episode costs three LLM calls and three embedding batches. This is the
setting that decides your bill.

| Value | |
|---|---|
| `10000` | Freshest memory, highest cost |
| `60000` | Roughly the production floor |
| `300000` | Cheap; memory lags minutes behind |
| `null` | Only on explicit `threads.end()` |

> The project-settings endpoint enforces `>= 60000`, so the shipped default
> cannot be re-entered through it. Thread overrides accept `>= 1000`.

---

## Per-call overrides

Two settings can be overridden without touching the project:

```ts
await memory.recall({
  dataset,
  query,
  limit: 20,           // overrides factsInContext
  minConfidence: 0.7,  // overrides retrievalMinConfidence
});
```

Useful for varying behaviour by surface — a wide net for a profile page, a tight
one for a chat turn — without maintaining two projects.

---

## Rules

1. **One setting at a time.** They interact; a combined change tells you nothing.
2. **Read-path settings are safe.** `factsInContext`, `retrievalMinConfidence`,
   `anchorVectorMin`, `anchorVectorTopK`, `contextEpisodes` and the weights only
   affect queries. Revert freely.
3. **Write-path settings are not.** `entityResolutionThreshold`,
   `factDedupThreshold`, `contradictionBandMin` change stored data.
   **Test on a throwaway dataset.**
4. **Nothing is retroactive.** Changing a write-path setting does not reprocess
   existing memory. There is no reprocessing command.
5. **Prompt beats parameters.** How you frame `context` in your system prompt
   usually moves answer quality more than any of these.

---

## When tuning won't help

Some problems are structural, not parametric:

| | |
|---|---|
| Facts about anything other than the user | Extraction discards them by design — [why](/concepts/semantic-memory/#every-fact-is-about-the-user) |
| Memory lagging 30 seconds behind | Inherent to async extraction; only `autoEpisodeIntervalMs` moves it |
| Anchor ranks being arbitrary | A known bug, not a setting |
| Facts accumulating forever | There is no forgetting or consolidation pass |

---

## Next

- [Retrieval](/concepts/retrieval/) — how ranking works
- [Project settings](/reference/project-settings/) — bounds and validation
- [Playground](/dashboard/playground/) — where to experiment

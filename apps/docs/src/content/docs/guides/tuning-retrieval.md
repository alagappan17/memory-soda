---
title: 'Tuning retrieval quality'
description: 'How to change retrieval settings without making things quietly worse.'
---

Precondition: recall returns too little, too much, or the wrong facts.
Outcome: a measured, single-setting change. Setting bounds and defaults:
[Project settings](/reference/project-settings/).

## Method first

Most tuning goes wrong because it is done blind. Before changing anything:

1. **Build a fixture.** One dataset with 15–30 facts across several entities. A
   throwaway `dataset` in the [Playground](/dashboard/playground/) is ideal.
2. **Write down the queries you care about**, with the facts you expect back.
3. **Record the baseline**, change **one setting**, re-run and diff.

```ts
const QUERIES = [
  {
    q: 'what car should I recommend?',
    expect: ['toyota corolla hybrid', 'under $30k'],
  },
  { q: 'what do I drive?', expect: ['honda civic'] },
  { q: 'what should we watch?', expect: ['sci-fi', 'horror'] },
];

async function evaluate(dataset: string) {
  const rows = [];
  for (const { q, expect } of QUERIES) {
    const { context, factCount } = await memory.recall({ dataset, query: q });
    const hits = expect.filter((e) => context.toLowerCase().includes(e));
    rows.push({ q, factCount, recall: `${hits.length}/${expect.length}` });
  }
  console.table(rows);
}
```

## Start here

Two settings account for most of the achievable improvement.

**`factsInContext` (default 8).** How many facts land in the block. Facts are
short, twenty of them is still only a few hundred tokens. **Raising this is
usually the first thing to try**, and usually safe. Per-call:
`recall({ …, limit: 20 })`.

**`retrievalMinConfidence` (default 0.5).** The floor on the extraction model's
self-rated confidence. Lower recalls weak inferences; `0.8` keeps only
explicitly stated facts. It also gates **invalidation**, a fact below the floor
can never supersede an existing one, so raising it makes memory more
conservative in both directions. Per-call: `recall({ …, minConfidence: 0.7 })`.

> Confidence is **self-reported and poorly calibrated**. Treat it as a coarse
> filter, not a probability.

## Symptom → setting

| Symptom                                              | Try                                                       |
| ---------------------------------------------------- | --------------------------------------------------------- |
| Relevant facts exist but aren't recalled             | Raise `factsInContext`; lower `retrievalMinConfidence`    |
| Irrelevant facts crowd the block                     | Lower `factsInContext`; raise `retrievalMinConfidence`    |
| Query mentions an entity but its facts don't surface | Lower `anchorVectorMin`; raise `anchorVectorTopK`         |
| Two entities that should be one                      | Lower `entityResolutionThreshold`, **future writes only** |
| One entity that should be two                        | Raise `entityResolutionThreshold`, existing merges stand  |
| Near-duplicate facts accumulating                    | Lower `factDedupThreshold`                                |
| Contradictions not being caught                      | Lower `contradictionBandMin`                              |
| Facts wrongly superseding each other                 | Raise `contradictionBandMin`                              |

## The anchor settings

When recall feels shallow, the
[entity-anchor signal](/concepts/retrieval/#signal-2-entity-anchor) is usually
why. `anchorVectorMin` (0.75) is the minimum query↔entity similarity to become
an anchor; `anchorVectorTopK` (3) caps how many vector-matched anchors are
admitted. Lowering `anchorVectorMin` admits more anchors, which pulls in every
fact touching them, powerful, and quick to flood the block with tangential
material. Move it in steps of `0.05` and watch what appears.

> **Known issue.** The anchor query has no `ORDER BY`, so the ranks it feeds
> into fusion reflect physical row order, not relevance. Raising
> `factsInContext` is a partial workaround.

## The write-path settings

These change **how facts are stored** and are not retroactive. Get them wrong
and you corrupt data rather than just degrade a query. Test on a throwaway
dataset.

**`entityResolutionThreshold` (0.88).** Cosine above which two same-type
entities merge. Too high: `toyota corolla hybrid` and `corolla hybrid` stay
separate, memory splits across two anchors. Too low: distinct entities collapse
into one, **irreversibly**. Check the [Entities](/dashboard/datasets/) tab for
near-duplicates before touching this.

**`factDedupThreshold` (0.95).** Cosine above which a new fact is a duplicate.
It also sets the **top of the contradiction band**
(`[contradictionBandMin, factDedupThreshold)` = `[0.80, 0.95)`), so lowering it
both widens deduplication and narrows contradiction detection. These two
settings are not independent.

**`contradictionBandMin` (0.80).** Lower bound of that band; pairs in it go to
the LLM judge even when predicates differ (`works at` vs `is employed by`).
Lower = more pairs judged, more cost, more risk of wrongly discarding a fact.

**`autoEpisodeIntervalMs` (1800000).** The cost lever: each episode costs three
LLM calls and three embedding batches, and this decides how often conversations
that trail off pay it. `null` = only on explicit `threads.end()`. Anything down
to `1000` is accepted, handy for tests.

## Rules

1. **One setting at a time.** They interact; a combined change tells you nothing.
2. **Read-path settings are safe to revert.** `factsInContext`,
   `retrievalMinConfidence`, the anchor settings, `contextEpisodes`.
3. **Write-path settings are not.** Nothing is retroactive and there is no
   reprocessing command.
4. **Prompt beats parameters.** How you frame `context` in your system prompt
   usually moves answer quality more than any of these.

## When tuning won't help

|                                             |                                                                                                                               |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Facts about a second subject in one dataset | One subject per dataset, only `user`-role statements are kept, [why](/concepts/semantic-memory/#every-fact-is-about-the-user) |
| Memory lagging behind the conversation      | Inherent to deferred extraction; `end()` or a lower `autoEpisodeIntervalMs` moves it                                          |
| Anchor ranks being arbitrary                | A known bug, not a setting                                                                                                    |
| Facts accumulating forever                  | There is no forgetting or consolidation pass                                                                                  |

## Next

- [Retrieval](/concepts/retrieval/), how ranking works
- [Project settings](/reference/project-settings/), bounds and validation

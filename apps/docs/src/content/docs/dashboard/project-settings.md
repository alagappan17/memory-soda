---
title: "Project settings"
description: "Per-project defaults for the episodic and semantic layers. Fifteen values, of which four are worth changing."
---
Per-project defaults for the episodic and semantic layers. Fifteen values, of
which four are worth changing.

Reach it from the sidebar's **Project Settings**, or the card on Home. Settings
apply to the project selected in the switcher.

Full field reference with bounds: [Project settings](/reference/project-settings/).

---

## Start with these four

| Setting | Default | What changing it does |
|---|---|---|
| `semantic.factsInContext` | `8` | Facts in the recall block. More context, more tokens. The main dial. |
| `semantic.retrievalMinConfidence` | `0.5` | Confidence floor. Raise to cut noise, lower to recall more. |
| `episodic.autoEpisodeIntervalMs` | `10000` | Idle time before extraction fires. Higher = cheaper, staler. |
| `episodic.enabled` / `semantic.enabled` | `true` | Turn a whole layer off. |

Everything else is internal retrieval tuning. Changing those without measuring
usually makes results worse — see [below](#the-other-eleven).

---

## Episodic settings

| Field | Default | Notes |
|---|---|---|
| `enabled` | `true` | Off means no episodes and therefore **no facts** — semantic memory depends on episodes |
| `autoEpisodeIntervalMs` | `10000` | Idle time before extraction. `null` disables the timer (explicit `end()` still works) |
| `maxMessages` | `100` | Transcript cap for extraction. Longer conversations are head+tail truncated |
| `maxRetries` | `3` | Retry cap for failed episodes |
| `contextEpisodes` | `3` | Episodes returned by `recall({ include: ['episodes'] })` |
| `similarityWeight` | `0.7` | Weight on vector similarity when ranking episodes |
| `recencyWeight` | `0.3` | Weight on recency |

### `autoEpisodeIntervalMs` is the cost lever

Each episode costs **three LLM calls and three embedding batches**. At the
default of 10 seconds, a conversation with natural pauses produces several
episodes and pays that each time.

| Value | Effect |
|---|---|
| `10000` (default) | Fresh memory, highest cost |
| `60000` | Roughly the sensible production floor |
| `300000` | Cheap, memory lags several minutes behind |
| `null` | Only extract when you call `threads.end()` |

> The form here enforces a minimum of **60000**, so the shipped default of
> `10000` cannot be re-entered once changed. Per-thread overrides accept values
> down to `1000` — use those for experiments.

---

## Semantic settings

| Field | Default | Notes |
|---|---|---|
| `enabled` | `true` | Off means messages are stored but no facts are extracted |
| `retrievalMinConfidence` | `0.5` | Facts below this are excluded from retrieval. Also the floor below which a new fact cannot invalidate an existing one |
| `factsInContext` | `8` | Facts in the rendered block |
| `entityResolutionThreshold` | `0.88` | Cosine above which two same-type entities merge |
| `factDedupThreshold` | `0.95` | Cosine above which a new fact is a duplicate |
| `contradictionBandMin` | `0.80` | Lower bound of the band judged for contradictions |
| `anchorVectorMin` | `0.75` | Minimum query↔entity similarity to anchor retrieval |
| `anchorVectorTopK` | `3` | Vector-matched anchors admitted per query |

### `factsInContext`

The one to tune first.

| Value | Trade-off |
|---|---|
| `4` | Tight, cheap. Misses relevant context on rich profiles |
| `8` (default) | Sensible middle |
| `15–20` | Better recall, more tokens, more chance of irrelevant facts distracting the model |

Facts are short — a block of 20 is still only a few hundred tokens. Raising this
is usually safe; measure the answers, not the token count.

### `retrievalMinConfidence`

Confidence is the extraction model's **self-rating**, which is not well
calibrated. Treat it as a coarse filter.

| Value | Effect |
|---|---|
| `0.3` | Recalls weak inferences — noisier |
| `0.5` (default) | Drops the model's own low-confidence guesses |
| `0.8` | Only explicitly stated facts. Safe but forgetful |

Raising it also makes fewer facts eligible to **invalidate** existing ones, so
memory becomes more conservative in both directions.

---

## The other eleven

`entityResolutionThreshold`, `factDedupThreshold`, `contradictionBandMin`,
`anchorVectorMin`, `anchorVectorTopK`, `maxMessages`, `maxRetries`,
`contextEpisodes`, `similarityWeight`, `recencyWeight` — plus the two `enabled`
flags — are internal constants exposed in the UI.

They interact. Two examples:

- Lowering `factDedupThreshold` widens deduplication **and narrows** the
  contradiction band, because the band is `[contradictionBandMin,
  factDedupThreshold)`. Fewer duplicates, fewer contradictions caught.
- Lowering `entityResolutionThreshold` merges more aggressively. Too low and
  distinct entities collapse into one, silently corrupting a user's memory —
  irreversibly, because the merge happens at write time.

If you change them: change **one at a time**, on a throwaway dataset in the
[Playground](/dashboard/playground/), and compare recall output before and after. See
[Tuning retrieval quality](/guides/tuning-retrieval/).

---

## How resolution works

```
built-in defaults  ─►  project settings  ─►  thread overrides
```

A project row stores only what you changed; the rest is merged from defaults at
read time. So a new default in a future version reaches every project that never
overrode it.

Thread-level overrides are accepted for **episodic settings only**, at thread
creation:

```ts
await memory.threads.create({
  dataset: 'user_42',
  settings: { episodic: { autoEpisodeIntervalMs: 1000 } },
});
```

There is no API for semantic overrides per thread, though the service layer
supports the concept.

---

## Changes are not retroactive

Settings affect **future** work only.

| Change | Effect on existing data |
|---|---|
| `factsInContext` | Immediate — it is a read-path setting |
| `retrievalMinConfidence` | Immediate — read-path filter |
| `entityResolutionThreshold` | Only new entities. Existing merges stand |
| `factDedupThreshold` | Only new extractions |
| `autoEpisodeIntervalMs` | Only newly scheduled episodes |
| `enabled: false` | Stops new extraction. Existing facts remain and are still recalled |

There is no reprocessing command. To re-extract with different settings you would
need to reset `semantic_status` in SQL and let the sweep job pick the episodes
back up.

---

## Over the API

```bash
curl -X PATCH http://localhost:3004/dashboard/projects/$PROJECT_ID/settings \
  -H "Authorization: Bearer $SESSION_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"semantic":{"factsInContext":12,"retrievalMinConfidence":0.6}}'
```

Partial and deep-merged — omitted fields are untouched. Returns the full merged
settings.

---

## Next

- [Project settings reference](/reference/project-settings/) — bounds and validation
- [Tuning retrieval quality](/guides/tuning-retrieval/) — how to change these safely
- [Playground](/dashboard/playground/) — where to experiment

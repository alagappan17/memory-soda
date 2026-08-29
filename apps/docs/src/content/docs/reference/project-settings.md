---
title: "Project settings"
description: "Fifteen values across two groups. Stored per project as partial JSON and merged over the defaults at read time, so a project row holds only what you changed."
---
Fifteen values across two groups. Stored per project as partial JSON and merged
over the defaults at read time, so a project row holds only what you changed.

```
built-in defaults  ─►  project.settings  ─►  thread override (episodic only)
```

- Read: `GET /dashboard/projects/:id/settings`
- Write: `PATCH /dashboard/projects/:id/settings`, partial, deep-merged
- UI: [Project settings](/dashboard/project-settings/)

---

## Episodic

| Field | Type | Default | Bounds (project) | Bounds (thread) |
|---|---|---|---|---|
| `enabled` | boolean | `true` |, |, |
| `autoEpisodeIntervalMs` | number \| null | `1800000` | `>= 1000` or `null` | `>= 1000` or `null` |
| `maxMessages` | integer | `100` | 10–1000 | 1–1000 |
| `maxRetries` | integer | `3` | 0–10 | 0–10 |
| `contextEpisodes` | integer | `3` | 1–20 | 1–20 |
| `similarityWeight` | number | `0.7` | 0–1 | 0–1 |
| `recencyWeight` | number | `0.3` | 0–1 | 0–1 |

### `enabled`
Off means no episodes, and therefore **no facts**, because semantic extraction
runs off episodes. Messages are still stored and `prepare()` still works.

### `autoEpisodeIntervalMs`
Idle time before extraction fires. `null` disables the timer and the
sleep-time backstop; `threads.end()` still works. Two other triggers ignore it:
`end()` and a new thread for the same dataset (which pulls a waiting sibling's
timer forward to at most 5 minutes).

**The main cost lever.** Each episode costs three LLM calls and three embedding
batches.

| Value | |
|---|---|
| `1800000` | Default. One episode per session gap |
| `300000` | Memory lags minutes behind; more episodes on long chats |
| `60000` | Freshest, pays per pause |
| `null` | Explicit `end()` only |

### `maxMessages`
Transcript cap for extraction. Longer conversations are truncated head + tail
(first 20 messages, then the tail, with a marker between).

### `maxRetries`
Retry cap for failed episode summarisation. The semantic-extraction retry cap is
a separate constant fixed at 3.

### `contextEpisodes`
Episodes returned by `recall({ include: ['episodes'] })`.

### `similarityWeight` / `recencyWeight`

```
relevance = cosineSimilarity × similarityWeight + 1/(1 + daysSince) × recencyWeight
```

**Not normalised**, used as given. `0.7/0.3` favours topical match; `0.4/0.6`
favours recent conversations.

---

## Semantic

| Field | Type | Default | Bounds |
|---|---|---|---|
| `enabled` | boolean | `true` |, |
| `retrievalMinConfidence` | number | `0.5` | 0–1 |
| `factsInContext` | integer | `8` | 1–100 |
| `entityResolutionThreshold` | number | `0.88` | 0–1 |
| `factDedupThreshold` | number | `0.95` | 0–1 |
| `contradictionBandMin` | number | `0.80` | 0–1 |
| `anchorVectorMin` | number | `0.75` | 0–1 |
| `anchorVectorTopK` | integer | `3` | 1–10 |

### `enabled`
Off means episodes are still summarised but no facts are extracted. Existing
facts remain and are still recalled.

### `retrievalMinConfidence`
Two roles:

1. Facts below it are **excluded from retrieval**.
2. A new fact below it can **never invalidate** an existing one.

Confidence is the extraction model's self-rating and is poorly calibrated,
a coarse filter, not a probability.

### `factsInContext`
Facts in the rendered block. The main quality/token dial. Per-call override:
`recall({ limit })`.

### `entityResolutionThreshold`
Cosine above which two **same-type** entities merge during resolution.

- Too high → `toyota corolla hybrid` and `corolla hybrid` stay separate, splitting a user's
  memory across two anchors.
- Too low → distinct entities collapse. **Irreversible.**

Applies at write time. Changing it neither merges nor un-merges existing rows.

### `factDedupThreshold`
Cosine above which a new fact is a duplicate and dropped.

Also the **upper bound of the contradiction band**, so lowering it widens
deduplication *and narrows* contradiction detection. These two settings are not
independent.

### `contradictionBandMin`
Lower bound of that band:

```
contradiction band = [contradictionBandMin, factDedupThreshold) = [0.80, 0.95)
```

Facts in the band are sent to the LLM judge even when their predicates differ,
which is what catches `works at` vs `is employed by`.

### `anchorVectorMin` / `anchorVectorTopK`
Control the [entity-anchor signal](/concepts/retrieval/#signal-2--entity-anchor):
the minimum query↔entity similarity to become an anchor, and how many
vector-matched anchors to admit. Entities named literally in the query are
always anchors regardless.

---

## Reading and writing

```bash
curl http://localhost:3004/dashboard/projects/$PROJECT_ID/settings \
  -H "Authorization: Bearer $SESSION_TOKEN"
```

```json
{
  "settings": {
    "episodic": { "enabled": true, "autoEpisodeIntervalMs": 1800000, "maxMessages": 100,
                  "maxRetries": 3, "contextEpisodes": 3,
                  "similarityWeight": 0.7, "recencyWeight": 0.3 },
    "semantic": { "enabled": true, "retrievalMinConfidence": 0.5, "factsInContext": 8,
                  "entityResolutionThreshold": 0.88, "factDedupThreshold": 0.95,
                  "contradictionBandMin": 0.8, "anchorVectorMin": 0.75,
                  "anchorVectorTopK": 3 }
  }
}
```

Always fully merged, so every field is present.

```bash
curl -X PATCH http://localhost:3004/dashboard/projects/$PROJECT_ID/settings \
  -H "Authorization: Bearer $SESSION_TOKEN" -H 'Content-Type: application/json' \
  -d '{"semantic":{"factsInContext":12}}'
```

Out-of-range values return `400` with the zod issues.

---

## Thread overrides

**Episodic only**, at creation:

```ts
await memory.createThread({
  dataset: 'user_42',
  settings: { episodic: { autoEpisodeIntervalMs: 1000, contextEpisodes: 5 } },
});
```

Null and undefined values are stripped before merging, so a partial override
cannot erase a project default.

The service layer supports semantic overrides per thread
(`threads.semantic_settings`), but **no API accepts them**.

---

## Per-call overrides

Two settings can be overridden on a single `recall()` without touching the
project:

```ts
await memory.recall({ dataset, query, limit: 20, minConfidence: 0.7 });
```

| Parameter | Overrides |
|---|---|
| `limit` | `factsInContext` |
| `minConfidence` | `retrievalMinConfidence` |

---

## Retroactivity

| Setting | Applies to |
|---|---|
| `factsInContext`, `retrievalMinConfidence`, `anchorVectorMin`, `anchorVectorTopK`, `contextEpisodes`, weights | Immediately, read path |
| `entityResolutionThreshold`, `factDedupThreshold`, `contradictionBandMin` | New extractions only |
| `autoEpisodeIntervalMs`, `maxMessages`, `maxRetries` | Newly scheduled work |
| `enabled: false` | Stops new work; existing data remains and is still recalled |

There is **no reprocessing command**. To re-extract with different settings, reset
`semantic_status` in SQL and let the sweep job pick the episodes up:

```sql
UPDATE episodes SET semantic_status = 'pending', semantic_retry_count = 0
WHERE dataset = 'user_42' AND status = 'completed';
```

---

## Which to touch

**Safe**, read path, revert freely: `factsInContext`, `retrievalMinConfidence`,
`anchorVectorMin`, `anchorVectorTopK`, `contextEpisodes`, `similarityWeight`,
`recencyWeight`.

**Careful**, changes stored data, not retroactive:
`entityResolutionThreshold`, `factDedupThreshold`, `contradictionBandMin`.

**Cost**, `autoEpisodeIntervalMs`.

Method for changing them without guessing:
[Tuning retrieval quality](/guides/tuning-retrieval/).

---

## Next

- [Tuning retrieval quality](/guides/tuning-retrieval/)
- [Project settings UI](/dashboard/project-settings/)
- [Retrieval](/concepts/retrieval/)

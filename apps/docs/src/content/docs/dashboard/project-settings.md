---
title: 'Project settings'
description: 'Per-project defaults for the episodic and semantic layers. Fifteen values, of which four are worth changing.'
---

Per-project defaults for the episodic and semantic layers. Fifteen values, of
which four are worth changing.

Reach it from the sidebar's **Project Settings**, or the card on Home. Settings
apply to the project selected in the switcher. Every field, with bounds,
defaults and retroactivity: [Project settings reference](/reference/project-settings/).

## Start with these four

| Setting                                 | Default   | What changing it does                                                |
| --------------------------------------- | --------- | -------------------------------------------------------------------- |
| `semantic.factsInContext`               | `8`       | Facts in the recall block. More context, more tokens. The main dial. |
| `semantic.retrievalMinConfidence`       | `0.5`     | Confidence floor. Raise to cut noise, lower to recall more.          |
| `episodic.autoEpisodeIntervalMs`        | `1800000` | Idle time before extraction fires. Lower = fresher, costlier.        |
| `episodic.enabled` / `semantic.enabled` | `true`    | Turn a whole layer off.                                              |

Everything else is internal retrieval tuning. The write-path thresholds
(`entityResolutionThreshold`, `factDedupThreshold`, `contradictionBandMin`)
change stored data irreversibly and interact with each other, change **one at a
time**, on a throwaway dataset in the [Playground](/dashboard/playground/),
following [Tuning retrieval quality](/guides/tuning-retrieval/).

> The `autoEpisodeIntervalMs` form field takes **minutes**; blank disables the
> timer. Per-thread overrides in code accept values down to `1000` ms, use
> those for experiments.

## Two traps

- `episodic.enabled: false` means no episodes and therefore **no facts**,
  semantic extraction runs off episodes.
- **Changes are not retroactive.** Read-path settings apply immediately;
  write-path settings affect only future extractions, and there is no
  reprocessing command.

## Over the API

```bash
curl -X PATCH http://localhost:3004/dashboard/projects/$PROJECT_ID/settings \
  -H "Authorization: Bearer $SESSION_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"semantic":{"factsInContext":12,"retrievalMinConfidence":0.6}}'
```

Partial and deep-merged, omitted fields are untouched. Returns the full merged
settings.

## Next

- [Project settings reference](/reference/project-settings/), every field, bounds and validation
- [Tuning retrieval quality](/guides/tuning-retrieval/), how to change these safely

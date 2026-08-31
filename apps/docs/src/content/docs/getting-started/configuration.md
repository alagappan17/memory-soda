---
title: 'Configuration'
description: 'Environment variables for the server, project settings for memory behaviour.'
---

Two independent layers:

1. **Environment variables**, how the server runs. Set once, at boot.
2. **Project settings**, how memory behaves. Editable at runtime, per project,
   with optional per-thread overrides.

## Environment variables

Copy `.env.example` to `.env` in the repo root. Both the API and the dashboard
read from it.

### Required

| Variable                       | Description                                                                |
| ------------------------------ | -------------------------------------------------------------------------- |
| `DATABASE_URL`                 | Postgres connection string. The database must have the `vector` extension. |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini key. Required to boot, the module throws at import without it.      |

### Optional

| Variable           | Default                 | Description                                               |
| ------------------ | ----------------------- | --------------------------------------------------------- |
| `HOST`             | `localhost`             | API bind address. Use `0.0.0.0` in a container.           |
| `PORT`             | `3004`                  | API port.                                                 |
| `CORS_ORIGIN`      | `http://localhost:3000` | Allowed browser origin(s), comma-separated.               |
| `MIGRATE_ON_START` | `true`                  | Run pending migrations on boot.                           |
| `VITE_API_URL`     | `http://localhost:3004` | API URL as the **browser** sees it. Dashboard build-time. |

### SDK-side

Read by `new MemorySoda()` in _your_ application, not by the server.

| Variable               | Description                  |
| ---------------------- | ---------------------------- |
| `MEMORY_SODA_BASE_URL` | e.g. `http://localhost:3004` |
| `MEMORY_SODA_API_KEY`  | `ms_…`                       |

Full details: [Environment variables](/reference/environment-variables/).

## Project settings

Every project has settings for the episodic and semantic layers. They are merged
over built-in defaults, so a project row only stores what you changed.

Edit them in the dashboard under **Project Settings**, or over the API:

```bash
curl -X PATCH http://localhost:3004/dashboard/projects/$PROJECT_ID/settings \
  -H "Authorization: Bearer $SESSION_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"semantic":{"factsInContext":12}}'
```

### The ones you will actually change

| Setting                                 | Default   | What it does                                                                      |
| --------------------------------------- | --------- | --------------------------------------------------------------------------------- |
| `semantic.factsInContext`               | `8`       | How many facts `recall()` puts in the context block. The main quality/token dial. |
| `semantic.retrievalMinConfidence`       | `0.5`     | Facts below this extraction confidence are excluded from retrieval.               |
| `episodic.autoEpisodeIntervalMs`        | `1800000` | Idle time before extraction fires. Lower = fresher and costlier.                  |
| `episodic.enabled` / `semantic.enabled` | `true`    | Turn a whole layer off.                                                           |

Everything else (thresholds, weights, retry caps) is a retrieval-tuning
constant; changing it without measuring will usually make results worse. Full
list, bounds and validation: [Project settings](/reference/project-settings/).

## Per-thread overrides

A thread can override the project's **episodic** settings at creation. Useful
for a thread that should extract on a different cadence, or not at all.

```ts
await memory.createThread({
  dataset: 'user_42',
  settings: {
    episodic: {
      autoEpisodeIntervalMs: 120_000, // extract after 2 minutes idle, not 30
    },
  },
});
```

```ts
// Ephemeral thread, never becomes long-term memory
await memory.createThread({
  dataset: 'user_42',
  settings: { episodic: { enabled: false } },
});
```

Resolution order, most specific wins:

```
built-in defaults  ─►  project.settings  ─►  thread.episodicSettings
```

> Semantic settings are resolved the same way in the service layer, but there is
> currently **no API to set them per thread**, only episodic overrides are
> accepted by `POST /v1/threads`.

## Compaction

Off by default. Enable it per thread by setting a threshold:

```ts
await memory.createThread({
  dataset: 'user_42',
  autoCompactThreshold: 30, // summarise once 30 un-compacted messages accumulate
});
```

> If you enable this, call `prepare()` with `messageLimit >= autoCompactThreshold`.
> Otherwise messages between the summary and the retrieved tail are silently
> dropped from context. `prepare()` returns a `warning` field when it detects
> this. See [Handling long conversations](/guides/long-conversations/).

## Next

- [Project settings reference](/reference/project-settings/), every field explained
- [Tuning retrieval quality](/guides/tuning-retrieval/), how to change these safely

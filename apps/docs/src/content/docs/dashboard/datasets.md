---
title: "Datasets"
description: "The memory browser. Everything the system knows about each user, and where it came from."
---
The memory browser. Everything the system knows about each user, and where it
came from.

This is the page you will spend the most time on.

---

## The dataset list

Every dataset in the selected project, newest activity first:

| Column | Meaning |
|---|---|
| Dataset | The identifier you passed as `dataset` |
| Threads | Conversations recorded for them |
| Facts | **Live** facts only — superseded and expired ones are not counted |
| Last activity | Most recent message across all their threads |

Search filters by dataset name (a substring match).

> The list is derived from **threads**. A dataset with facts but no threads —
> possible if threads were deleted in SQL — will not appear here even though its
> memory still exists.

---

## Inside a dataset

Selecting one opens four views over the same person.

### Conversations

Threads, and the full message history of each: role, content, sequence number,
timestamp, and any `tokens` / `model` / `latencyMs` you supplied.

**Compacted messages are shown too**, unlike `prepare()`, which hides them. This
is the only place to see what a summary replaced.

Use it to answer: *what did the user actually say?*

### Episodes

Every [episode](/concepts/episodic-memory/) for the dataset — the summary,
its key learnings, the message count, and the window it covered.

Use it to answer: *what did the system think this conversation was about?*

> Episode `status` is shown, but **`semanticStatus` is not**. An episode can read
> `completed` while its fact extraction failed. See
> [below](#when-facts-are-missing).

### Facts

The extracted [semantic memory](/concepts/semantic-memory/), newest first.

Each row shows subject, predicate, object, the validity window, and the state:

| State | Meaning |
|---|---|
| **current** | Live and retrievable now |
| **superseded** | A contradicting fact won, or someone deleted it |
| **expired** | Its `validUntil` passed |

A toggle includes superseded and expired facts. Leave it on when debugging —
"the memory is wrong" is usually "the memory changed and you are seeing the new
one".

Facts can be **deleted** here. Soft delete: it stamps `invalidAt`, leaves
retrieval immediately, and stays queryable by history and `asOf`. See
[Curating memory](/guides/curating-memory/).

### Entities

The resolved canonical nouns — name and type (`PERSON`, `ORG`, `PLACE`,
`PRODUCT`, …), most recently mentioned first.

Use it to check [entity resolution](/concepts/semantic-memory/#resolution).
Two entities that should be one — `dji osmo pocket 3` and `pocket 3` — means the
similarity threshold did not merge them, and the user's memory is split.

> Entities are shown as a flat list. There is no graph visualisation.

---

## Typical investigations

### "The assistant doesn't know something the user told it"

1. **Conversations** — is the message actually recorded?
2. **Episodes** — did an episode cover it? Extraction only runs on episodes.
3. **Facts** with history on — was it extracted and then superseded?
4. If the episode exists but the fact does not, extraction dropped it. Common
   reasons: the subject was not the user, it was judged transient task chatter,
   or it was merged into a more specific fact.

### "The assistant said something outdated"

1. **Facts** with history on. Find both versions.
2. Check `validAt` on each. The newer statement should have superseded the older.
3. If both are current, the contradiction judge returned `neither` — it did not
   consider them mutually exclusive. Delete the stale one.

### "Memory is duplicated"

Check **Entities**. Near-duplicate entities split facts across two anchors and
weaken retrieval. Raising or lowering `entityResolutionThreshold` changes the
merge behaviour — see [Tuning retrieval](/guides/tuning-retrieval/).

### When facts are missing

If an episode looks `completed` but produced nothing, its semantic pass may have
failed. That state is not surfaced anywhere in the UI:

```sql
SELECT id, status, semantic_status, semantic_retry_count, error
FROM episodes
WHERE dataset = 'user_42'
ORDER BY created_at DESC
LIMIT 20;
```

---

## What this page cannot do

| | Alternative |
|---|---|
| Delete a whole dataset | No UI, no endpoint — [Privacy and data deletion](/operations/privacy-and-deletion/) |
| Edit or add a fact | Delete only; facts are derived |
| See extraction failures | SQL, as above |
| See which facts a past reply used | [Playground](/dashboard/playground/), current session only |
| Export | No export button — use the API or `pg_dump` |
| Visualise the graph | Not implemented |

---

## Relationship to the API

Everything here is available programmatically:

| View | Endpoint |
|---|---|
| Dataset list | `GET /dashboard/browse/datasets?projectId=` |
| Conversations | `GET /dashboard/browse/threads?projectId=&dataset=` |
| Messages | `GET /dashboard/browse/threads/:id/messages?projectId=` |
| Episodes | `GET /dashboard/browse/datasets/:dataset/episodes?projectId=` |
| Facts | `GET /dashboard/browse/datasets/:dataset/facts?projectId=` |
| Entities | `GET /dashboard/browse/datasets/:dataset/entities?projectId=` |
| Delete a fact | `DELETE /dashboard/v1/memory/semantic/datasets/:dataset/facts/:factId?projectId=` |

The `/v1` equivalents do the same with an API key —
[Semantic memory API](/api/semantic-memory/).

---

## Next

- [Playground](/dashboard/playground/) — watch extraction happen live
- [Curating and correcting memory](/guides/curating-memory/)
- [Semantic memory](/concepts/semantic-memory/)

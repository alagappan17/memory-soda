---
title: 'Datasets'
description: 'Export or erase everything held about one dataset.'
---

A dataset usually maps to a person, so these are the two things a person is
entitled to ask for: everything you hold about me, and none of it.

## `exportDataset()`

```ts
export(dataset: string): Promise<DatasetExport>
```

Everything stored for a dataset, threads with their messages, episodes, facts
(live and superseded), and resolved entities, in one response.

```ts
const dump = await memory.exportDataset('u_42');

dump.threads.length; // 3
dump.facts.length; // 27
```

Scoped to the API key's project, so one project can never export another's
memory.

This is a full read, not a paginated one. For a dataset with a long history it
is a large response; treat it as an export endpoint, not a listing endpoint,
use [`memory.listFacts()`](/sdk/semantic-memory/) for anything interactive.

## `forgetDataset()`

```ts
forget(dataset: string): Promise<DatasetDeletion>
```

Erase a dataset: every thread, message, episode, fact and entity.

```ts
const { deleted } = await memory.forgetDataset('u_42');
// { threads: 3, episodes: 5, facts: 27, entities: 12 }
```

**A hard delete.** This is not the soft invalidation
[`memory.deleteFact()`](/sdk/semantic-memory/) performs, nothing survives, and
[point-in-time recall](/guides/point-in-time-recall/) will not report the erased
facts as having ever been true. That is the point: a deletion request is not
satisfied by a flag.

It runs in one transaction, so a partial erase is not a state the system can end
up in. Messages go with their threads by cascade.

There is no undo. If you want the data first, `export()` it.

---
title: "Projects and datasets"
description: "Every row of memory is scoped by two keys. Understanding them takes two minutes and prevents most integration mistakes."
---
Every row of memory is scoped by two keys. Understanding them takes two minutes
and prevents most integration mistakes.

```
project  ──►  "which application is this?"     a UUID, resolved from your API key
dataset  ──►  "whose memory is this?"          a string you choose
```

---

## Projects

A project is the top-level tenant. It owns API keys, threads, episodes, facts,
entities and settings.

- Created from the dashboard, or automatically as `default` on first boot.
- Each API key belongs to exactly one project.
- **You never pass a project ID to `/v1/*`**, it is derived from the key on
  every request. This is why a leaked key exposes exactly one project.

Use separate projects when you want separate **settings** or separate **blast
radius**: staging vs production, or two unrelated products sharing one
deployment.

```ts
// Nothing to configure, the key decides.
const memory = new MemorySoda({ baseUrl, apiKey: STAGING_KEY });
```

---

## Datasets

A dataset is the memory store for one subject, almost always one end user.

- A free-form string. **Created implicitly on first write**; there is no
  provisioning call.
- Facts, entities and episodes are all scoped to `(projectId, dataset)`.
- Threads carry a dataset; memory belongs to the dataset, **not** the thread.

That last point is the important one:

```ts
// Monday
const a = await memory.createThread({ dataset: 'user_42' });
await memory.addMessage(a.threadId, {
  role: 'user', content: 'I only drink decaf after 2pm.',
});

// Friday, a completely different thread
const b = await memory.createThread({ dataset: 'user_42' });
const { context } = await memory.recall({ dataset: 'user_42', query: 'coffee' });
// → "- user only drinks decaf after 2pm  (valid: … – present)"
```

### Choosing a dataset key

**Do**

```ts
dataset: user.id                    // an immutable primary key
dataset: `org_${orgId}_${userId}`   // namespaced, still deterministic
```

**Don't**

```ts
dataset: user.email      // changes; memory splits in two when it does
dataset: sessionId       // a new store every visit, nothing accumulates
dataset: 'default'       // every user's memory merged into one pile
```

The rule: it must be reconstructible at query time from data you already hold,
and it must never change for the same person.

### If you omit it

`threads.create()` generates a random dataset when you don't pass one. Useful
for demos and the playground; a bug in production, because you can never recall
that memory again without having stored the generated value.

```ts
const { threadId, dataset } = await memory.createThread({});
// dataset === 'usr_9f3ka2be', keep it or lose it
```

---

## Isolation guarantees

| Boundary | Enforced by |
|---|---|
| project ↔ project | every query filters on `projectId`, derived from the API key |
| dataset ↔ dataset | every memory query filters on `dataset` |
| thread ↔ thread | `threadId` plus a `projectId` check on every read |

A request bearing project A's key cannot see project B's data, and
`recall({ dataset: 'user_1' })` cannot return `user_2`'s facts.

**What is *not* isolated:** every dataset inside a project is visible to any key
for that project. There are no per-dataset or read-only keys. If you are
multi-tenant and tenants must not see each other even by mistake, give each
tenant its own project and its own key.

---

## Enumerating datasets

There is no `/v1` endpoint that lists datasets, by design, so a leaked
integration key cannot enumerate your users. The dashboard can, behind a login
session:

```
GET /dashboard/browse/datasets?projectId=<uuid>&q=&limit=50&offset=0
```

```json
{
  "users": [
    { "dataset": "user_42", "threadCount": 3, "factCount": 17,
      "lastActivityAt": "2026-08-16T09:14:02.114Z" }
  ],
  "total": 1
}
```

The list is derived from `threads`, so a dataset with facts but no threads will
not appear.

---

## Cardinality

Nothing is provisioned per dataset, no table, no index, no namespace. A dataset
is just a string in a `WHERE` clause backed by composite indexes on
`(dataset, project_id, …)`.

Millions of datasets are fine. A single dataset with a very large number of live
facts is the thing to watch: the extraction pipeline loads **all** live facts for
a dataset into memory on every run. See
[Limits and defaults](/reference/limits/).

---

## Next

- [Working memory](/concepts/working-memory/), threads and messages
- [Semantic memory](/concepts/semantic-memory/), what actually gets stored per dataset

---
title: 'Curating and correcting memory'
description: 'What to do when a fact is wrong.'
---

Precondition: a wrong or stale fact in the store. Outcome: it is superseded,
deleted, or replaced.

**Memory is derived, not authored.** You cannot write or edit a fact, you can
only delete one, or say something that supersedes it.

| Tool                                | Use when                                          |
| ----------------------------------- | ------------------------------------------------- |
| **Let the user correct themselves** | The fact was right and is now stale               |
| **Delete the fact**                 | It is wrong, was never true, or must go now       |
| **Delete and re-teach**             | It is wrong _and_ you know what should replace it |

## 1. Correction through conversation

The intended path. The user says something contradicting a stored fact;
extraction judges the pair and supersedes the loser.

```
user: "Actually I switched to a Tesla Model 3 last month."

→ old:  user drives honda civic    invalidAt = now
→ new:  user drives tesla model 3    validAt = now
```

Works for **exclusive** states, one employer, one home city. It does **not**
fire when the facts can coexist ("I'm learning Rust" then "I'm learning Go" →
both kept).

Limits:

- **Latency.** Extraction is deferred, so the correction is not retrievable
  immediately.
- **Confidence gate.** A correction extracted below `retrievalMinConfidence`
  (default 0.5) is stored but **never allowed to invalidate** anything.
- **The judge defaults to `neither`** on uncertainty and keeps both.

Conversational correction is not a reliable delete. If something must be gone,
delete it.

## 2. Deleting a fact

```ts
const { facts } = await memory.listFacts('user_42', { q: 'honda civic' });
await memory.deleteFact('user_42', facts[0].factId);
// { factId: '3a91…', deleted: true }
```

A **soft delete**, it stamps `invalidAt`. The fact leaves retrieval immediately
and stays queryable through `includeInvalidated` and `asOf`. `404` if it does
not exist, belongs to another dataset, or is already invalidated.

The [Datasets](/dashboard/datasets/) page has a delete control on each row.
There is no bulk endpoint; delete a group sequentially.

## 3. Delete and re-teach

Deleting removes a wrong fact but leaves a gap. To fill it, feed the correct
statement through a thread:

```ts
await memory.deleteFact('user_42', wrongFactId);

const { threadId } = await memory.createThread({ dataset: 'user_42' });
await memory.addMessage(threadId, {
  role: 'user',
  content:
    'To be clear: I like sci-fi, not fantasy. Dune yes, Lord of the Rings no.',
});
await memory.endThread(threadId); // extract now rather than on the timer
```

A workaround for the absent write API, and it costs three LLM calls. But it is
the only way to _add_ knowledge.

> Phrase corrections **as the user speaking about themselves**. Extraction
> discards anything whose subject is not the user.

## Building a "forget this" feature

```ts
export async function forget(dataset: string, query: string) {
  const { facts } = await memory.listFacts(dataset, { q: query, limit: 100 });
  for (const f of facts) await memory.deleteFact(dataset, f.factId);
  return facts.map((f) => `${f.subject} ${f.predicate} ${f.object}`);
}
```

`q` is a keyword filter, not semantic search. To find candidates semantically,
use `recall({ query, include: ['raw'] })` and let the user pick.

**Show the user what will be deleted before deleting it.** Deletion is
irreversible through the API.

## Provenance

Every fact records `sourceQuote` (the verbatim user words) and `episodeId`.
`sourceQuote` is **not** in the rendered `context` block, request
`include: ['raw']` to get it. To audit history, use `includeInvalidated` and
`asOf`, see [Point-in-time recall](/guides/point-in-time-recall/).

## Memory poisoning

A user can deliberately teach false facts, and those facts will be recalled in
every future session. The existing defences (fenced extraction, data-framed
context block) stop injection _through_ memory; they do not stop a user
asserting falsehoods about themselves.

**The only remedy is deletion at the data layer.** Correcting the agent in
conversation does not work, the poisoned fact is still in the store.

If you accept untrusted input: review facts for high-risk datasets, delete
everything from an adversarial session (`?episodeId=` gives you exactly that
set), and never let stored memory drive privileged actions without a separate
check.

## What you cannot do

|                                   |                                                                |
| --------------------------------- | -------------------------------------------------------------- |
| Create a fact directly            | No write API                                                   |
| Edit a fact                       | Delete and re-teach                                            |
| Pin a fact against supersession   | No immutability flag                                           |
| Undelete                          | `invalidAt` cannot be cleared through the API                  |
| Bulk delete a dataset             | [Privacy and data deletion](/operations/privacy-and-deletion/) |
| Merge two entities after the fact | Resolution happens at write time only                          |

Undelete is possible in SQL
(`UPDATE facts SET invalid_at = NULL WHERE id = …`), but check first that
nothing superseded it in the meantime, or you will have two live contradicting
facts.

## Next

- [Point-in-time recall](/guides/point-in-time-recall/)
- [Privacy and data deletion](/operations/privacy-and-deletion/)

---
title: "Curating and correcting memory"
description: "What to do when a fact is wrong."
---
What to do when a fact is wrong.

The short version: **memory is derived, not authored.** You cannot write or edit
a fact, you can only delete one, or say something that supersedes it.

---

## The three tools

| Tool | Use when |
|---|---|
| **Let the user correct themselves** | The fact was right and is now stale |
| **Delete the fact** | It is wrong, was never true, or must go now |
| **Delete and re-teach** | It is wrong *and* you know what should replace it |

---

## 1. Correction through conversation

The intended path. The user says something contradicting a stored fact;
extraction judges the pair and supersedes the loser.

```
user: "Actually I switched to a Tesla Model 3 last month."

→ old:  user drives honda civic    invalidAt = now
→ new:  user drives tesla model 3    validAt = now
```

Works well for **exclusive** states, one employer, one home city, one current
phone. The judge is asked which of the two survives, and the most recent
statement wins.

It does **not** fire when the facts can coexist:

```
"I'm learning Rust."   then later   "I'm learning Go."
→ both kept. A person can learn two languages.
```

That is usually right. When it is not, delete.

### Limits

- **Latency.** 20–60 seconds before the correction is retrievable.
- **Confidence gate.** A correction extracted below `retrievalMinConfidence`
  (default 0.5) is stored but **never allowed to invalidate** anything.
- **The judge defaults to `neither`.** On uncertainty it keeps both, because
  destroying knowledge is worse than a redundant row.

Conversational correction is not a reliable delete. If something must be gone,
delete it.

---

## 2. Deleting a fact

```ts
await memory.deleteFact('user_42', factId);
// { factId: '3a91…', deleted: true }
```

```bash
curl -X DELETE "$API/v1/memory/semantic/datasets/user_42/facts/$FACT_ID" \
  -H "Authorization: Bearer $KEY"
```

A **soft delete**, it stamps `invalidAt`. The fact leaves retrieval immediately
and stays queryable through `includeInvalidated` and `asOf`.

`404` if it does not exist, belongs to another dataset, or is already
invalidated.

### Finding the id

```ts
const { facts } = await memory.listFacts('user_42', { q: 'honda civic' });
for (const f of facts) {
  console.log(f.factId, f.subject, f.predicate, f.object);
}
```

Or use the [Datasets](/dashboard/datasets/) page, which has a delete control
on each row.

### Deleting a group

```ts
const { facts } = await memory.listFacts('user_42', { q: 'car' });
for (const f of facts) {
  await memory.deleteFact('user_42', f.factId);
}
```

Sequential, there is no bulk endpoint.

---

## 3. Delete and re-teach

Deleting removes a wrong fact but leaves a gap. To fill it, feed the correct
statement through a thread:

```ts
// 1. remove the wrong fact
await memory.deleteFact('user_42', wrongFactId);

// 2. state the truth as the user would
const { threadId } = await memory.createThread({
  dataset: 'user_42',
  metadata: { source: 'correction' },
});
await memory.addMessage(threadId, {
  role: 'user',
  content: 'To be clear: I like sci-fi, not fantasy. Dune yes, Lord of the Rings no.',
});
await memory.endThread(threadId);   // extract now rather than on the timer

// 3. wait ~30s, then verify
```

It is a workaround for the absent write API, and it costs three LLM calls. But it
is the only way to *add* knowledge.

> Phrase corrections **as the user speaking about themselves**. Extraction
> discards anything whose subject is not the user, so "the user likes sci-fi"
> written in third person may not extract cleanly. Write it first-person.

---

## Building a "forget this" feature

```ts
export async function forget(dataset: string, query: string) {
  const { facts } = await memory.listFacts(dataset, { q: query, limit: 100 });

  const deleted = [];
  for (const f of facts) {
    await memory.deleteFact(dataset, f.factId);
    deleted.push(`${f.subject} ${f.predicate} ${f.object}`);
  }
  return deleted;
}
```

`q` is a keyword filter, not semantic search, it matches literal terms in
subject, predicate or object. To find candidates semantically:

```ts
const { facts } = await memory.recall({
  dataset,
  query: 'anything about my old job',
  include: ['raw'],
  limit: 50,
});
// then let the user pick which to delete
```

**Show the user what will be deleted before deleting it.** Deletion is
irreversible through the API.

---

## Auditing a change

Nothing is physically removed, so you can always reconstruct history.

```ts
// everything, including superseded and expired
const { facts } = await memory.listFacts('user_42', {
  includeInvalidated: true,
});

const now = Date.now();
for (const f of facts) {
  const state = f.invalidAt ? 'superseded'
    : f.validUntil && new Date(f.validUntil).getTime() <= now ? 'expired'
    : 'current';
  console.log(`[${state}] ${f.predicate} ${f.object}  (${f.validAt} → ${f.validUntil ?? '-'})`);
}
```

Or ask what was believed at a moment:

```ts
const { context } = await memory.recall({
  dataset: 'user_42',
  asOf: '2026-06-01T00:00:00Z',
});
```

See [Point-in-time recall](/guides/point-in-time-recall/).

---

## Provenance

Every fact records where it came from:

| Field | |
|---|---|
| `sourceQuote` | The verbatim user words supporting it |
| `episodeId` | The episode that produced it |

```ts
const { facts } = await memory.listFacts('user_42');
facts.forEach((f) => console.log(`"${f.sourceQuote}" → ${f.predicate} ${f.object}`));
```

Everything one episode extracted:

```bash
curl "$API/v1/memory/semantic/datasets/user_42/facts?episodeId=$EPISODE_ID" \
  -H "Authorization: Bearer $KEY"
```

> `sourceQuote` is **not** in the rendered `context` block. Request
> `include: ['raw']` to get it.

---

## Memory poisoning

A user can deliberately teach false facts, and those facts will be recalled in
every future session.

The defences that exist:

- Extraction is fenced, a transcript cannot instruct the extractor.
- The rendered block is framed as untrusted data in the prompt.
- Facts are collapsed to one line so they cannot break out of the block.

Those stop injection *through* memory. They do not stop a user asserting
falsehoods about themselves.

**The only remedy is deletion at the data layer.** Correcting the agent in
conversation does not work, the poisoned fact is still in the store and gets
retrieved again next session.

If you accept untrusted input:

- Review facts for high-risk datasets.
- Consider deleting everything from a session you believe was adversarial:
  `?episodeId=` gives you exactly that set.
- Never let stored memory drive privileged actions without a separate check.

---

## What you cannot do

| | |
|---|---|
| Create a fact directly | No write API |
| Edit a fact | Delete and re-teach |
| Pin a fact against supersession | No immutability flag |
| Undelete | `invalidAt` cannot be cleared through the API |
| Bulk delete a dataset | [Privacy and data deletion](/operations/privacy-and-deletion/) |
| Merge two entities after the fact | Resolution happens at write time only |

Undelete and entity merges are possible in SQL, carefully:

```sql
-- undo a soft delete
UPDATE facts SET invalid_at = NULL, updated_at = now() WHERE id = '3a91…';
```

Check first that nothing superseded it in the meantime, or you will have two live
contradicting facts.

---

## Next

- [Point-in-time recall](/guides/point-in-time-recall/)
- [The bi-temporal model](/concepts/bi-temporal-model/)
- [Privacy and data deletion](/operations/privacy-and-deletion/)

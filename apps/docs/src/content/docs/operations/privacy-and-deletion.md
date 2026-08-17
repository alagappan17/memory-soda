---
title: "Privacy and data deletion"
description: "memory-soda stores personal data by design. If you run it against real users, you are the data controller and these obligations are yours."
---
memory-soda stores personal data by design. If you run it against real users, you
are the data controller and these obligations are yours.

---

## What is stored

| Table | Contains |
|---|---|
| `messages` | **Verbatim conversation content.** Everything your users type. |
| `episodes` | LLM-written summaries and key learnings of those conversations |
| `facts` | Extracted claims about users, plus a **verbatim `sourceQuote`** |
| `entities` | Names of people, places, organisations a user mentioned |
| `threads` | Your `metadata`, `tags`, and the `dataset` identifier |
| `users`, `sessions` | Dashboard operator accounts. Not end-user data. |

Embeddings of all of the above are also stored. **An embedding is derived
personal data** — treat it with the same care as the text.

---

## Where it leaves the system

| Destination | What |
|---|---|
| **Google Gemini** | Full conversation transcripts, for summarisation, extraction and contradiction judging. Fact text, for embedding. |
| **Your logs** | See below — this one surprises people. |

### Logging

`prepare()` and `recall()` currently log their **full payloads** to stdout:

```ts
console.log(`[prepare] ── response ── thread=${threadId}\n` + JSON.stringify(result, null, 2));
```

That means **every message body and every recalled fact goes to stdout** on every
call. If you ship logs to a collector, they contain personal data and inherit
your retention rules.

Before running against real users, either patch out those two `console.log`
calls, or filter at the collector.

### Gemini

Conversation content is sent to Google. Under a paid Gemini API tier, data is not
used to train models — verify the current terms for your account and region.

If your users must not have their data leave your infrastructure, memory-soda is
not currently usable: the provider is hard-wired and there is no local-model
option.

---

## Deleting one fact

```ts
await memory.semantic.deleteFact('user_42', factId);
```

A **soft delete** — it stamps `invalidAt`. The fact leaves retrieval but the row,
its `sourceQuote` and its embedding remain in the database.

> **Soft delete is not erasure.** For a GDPR Article 17 request it is not
> sufficient.

---

## Deleting a whole user

There is **no API for this.** No `DELETE /v1/datasets/:dataset`, no UI button.
You must do it in SQL.

```sql
BEGIN;

-- messages go with their threads via ON DELETE CASCADE
DELETE FROM messages WHERE thread_id IN (
  SELECT id FROM threads WHERE dataset = 'user_42' AND project_id = '<project>'
);
DELETE FROM scheduled_episodes WHERE thread_id IN (
  SELECT id FROM threads WHERE dataset = 'user_42' AND project_id = '<project>'
);
DELETE FROM facts    WHERE dataset = 'user_42' AND project_id = '<project>';
DELETE FROM entities WHERE dataset = 'user_42' AND project_id = '<project>';
DELETE FROM episodes WHERE dataset = 'user_42' AND project_id = '<project>';
DELETE FROM threads  WHERE dataset = 'user_42' AND project_id = '<project>';

COMMIT;
```

Verify:

```sql
SELECT
  (SELECT count(*) FROM threads  WHERE dataset = 'user_42') AS threads,
  (SELECT count(*) FROM facts    WHERE dataset = 'user_42') AS facts,
  (SELECT count(*) FROM entities WHERE dataset = 'user_42') AS entities,
  (SELECT count(*) FROM episodes WHERE dataset = 'user_42') AS episodes;
```

All zero.

> Order matters — `facts.episode_id` references `episodes` with
> `ON DELETE SET NULL`, so deleting episodes first orphans facts rather than
> removing them. Delete facts first.

Wrap it in a script and keep it with your other data-subject tooling, because you
will need it under time pressure.

---

## Deleting a project

```
DELETE /dashboard/projects/:id
```

Cascades at the database level to API keys, threads, messages, episodes, facts
and entities. Irreversible, and the correct tool for decommissioning an entire
tenant.

---

## Exporting a user's data

For a subject access request:

```sql
COPY (
  SELECT m.created_at, m.role, m.content
  FROM messages m
  JOIN threads t ON t.id = m.thread_id
  WHERE t.dataset = 'user_42' AND t.project_id = '<project>'
  ORDER BY t.created_at, m.sequence_number
) TO STDOUT WITH CSV HEADER;

COPY (
  SELECT subject, predicate, object, source_quote, confidence,
         valid_at, valid_until, invalid_at, created_at
  FROM facts
  WHERE dataset = 'user_42' AND project_id = '<project>'
  ORDER BY created_at
) TO STDOUT WITH CSV HEADER;
```

Or via the API:

```ts
const facts = await memory.semantic.listFacts(dataset, { includeInvalidated: true, limit: 100 });
const entities = await memory.semantic.listEntities(dataset);
```

Note `listFacts` caps at 100 — for a full export use SQL.

---

## Retention

**Nothing expires.** There is no TTL, no forgetting pass, no consolidation.
Messages, episodes, facts and superseded facts accumulate indefinitely.

If your policy requires retention limits, implement them yourself:

```sql
-- delete conversations older than two years
DELETE FROM threads
WHERE last_activity_at < now() - interval '2 years';
-- messages, episodes and scheduled rows cascade

-- purge long-superseded facts
DELETE FROM facts
WHERE invalid_at IS NOT NULL
  AND invalid_at < now() - interval '1 year';
```

Run on a schedule. Deleting threads does **not** delete the facts derived from
them — facts are scoped to the dataset, not the thread, and outlive it.

---

## Data minimisation

Two useful levers:

**Turn off long-term memory per thread** when a conversation should not become
durable:

```ts
await memory.threads.create({
  dataset: userId,
  settings: { episodic: { enabled: false } },
});
```

Messages are still stored; nothing becomes a fact.

**Keep sensitive content out entirely.** memory-soda has no field-level
redaction, no PII detection and no content filtering. If certain categories must
never be stored, filter before calling `addMessage`.

---

## The extraction prompt as a control

Extraction is deliberately narrow — it discards task chatter, assistant
explanations, and anything whose subject is not the user. That reduces incidental
retention, but it is a **quality heuristic, not a privacy control**. It is an LLM
following instructions; do not rely on it to suppress a category of data.

If a user states a special-category fact about themselves — health, religion,
sexuality — it will be extracted and stored like any other.

---

## Memory poisoning

A user can deliberately teach false facts, which are then recalled in every
future session.

The only reliable remedy is **deletion at the data layer**. Correcting the agent
in conversation does not work: the poisoned fact stays in the store and gets
retrieved again next session.

To remove everything one session produced:

```bash
curl "$API/v1/memory/semantic/datasets/user_42/facts?episodeId=$EPISODE_ID" \
  -H "Authorization: Bearer $KEY"
# then delete each returned factId
```

See [Curating memory](/guides/curating-memory/).

---

## Compliance checklist

- [ ] Privacy notice covers memory extraction and the Gemini sub-processor
- [ ] A written legal basis for storing derived personal data
- [ ] Deletion script written, tested and findable under time pressure
- [ ] Export script written and tested
- [ ] Retention job scheduled, if your policy requires one
- [ ] Payload logging patched out or filtered at the collector
- [ ] Backups covered by the same retention and deletion policy
- [ ] Postgres encrypted at rest; TLS in transit
- [ ] Dashboard access limited — every operator can read every dataset
- [ ] Gemini terms reviewed for your account tier and region

> **Backups.** Deleting a row does not remove it from yesterday's `pg_dump`. An
> erasure request needs a documented position on backup retention.

---

## Known gaps

| Gap | Impact |
|---|---|
| No bulk-delete endpoint | Erasure requires database access |
| Soft delete only via the API | `sourceQuote` and embeddings survive |
| Full payloads logged | Personal data in stdout by default |
| No retention or forgetting | Data grows without limit |
| Provider hard-wired | Cannot run without sending data to Google |
| No field-level encryption | Content is plaintext in Postgres |
| No audit log | No record of who read or deleted what |
| Dashboard has no per-project permissions | Every operator sees everything |

---

## Next

- [Curating and correcting memory](/guides/curating-memory/)
- [Self-hosting](/operations/self-hosting/)
- [Database schema](/reference/database-schema/)

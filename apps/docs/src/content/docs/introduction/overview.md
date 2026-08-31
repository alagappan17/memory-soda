---
title: 'Overview'
description: 'Memory Soda gives an LLM application durable memory about its users.'
---

Memory Soda gives an LLM application durable memory about its users.

You send it conversations. It works out which statements are worth keeping,
resolves them against what it already believes, and gives you back a
prompt-ready block of text before your next model call.

```
┌──────────────┐   messages    ┌──────────────┐   facts    ┌──────────────┐
│  Your app    │ ────────────► │ Memory Soda  │ ─────────► │  Postgres    │
│              │ ◄──────────── │              │ ◄───────── │  + pgvector  │
└──────────────┘   context     └──────────────┘  retrieval └──────────────┘
```

## The problem it solves

An LLM has no memory between calls. The usual fixes both break down:

- **Send the whole history every turn.** Costs grow linearly, latency grows with
  them, and past a few thousand turns it stops fitting at all.
- **Embed everything and do RAG over the transcript.** You retrieve _messages_,
  not _knowledge_. "I drive a Honda Civic" and "I switched to a Model 3 last month" both
  come back with similar scores, and the model has to guess which is current.

Memory Soda stores **claims, not transcripts**. Each claim carries the window of
time it is true for, so a contradiction supersedes rather than accumulates.

## What you get

**A prompt-ready context block.** Not embeddings, not JSON you have to format,
a string you paste into your system prompt.

```
Known facts about the user, most relevant first.

# FACTS  (format: fact (valid: from – to))
- user is interested in toyota corolla hybrid  (valid: 2026-08-15 – present)
- user finds too big suvs  (valid: 2026-08-15 – present)
- user drives honda civic  (valid: 2026-03-01 – present)

# ENTITIES
- toyota corolla hybrid (PRODUCT)
- honda civic (PRODUCT)
```

**Contradiction handling.** When a user says something that conflicts with a
stored fact, an LLM judge decides which one survives. The loser is marked
superseded, not deleted, the history stays queryable.

**Time-travel queries.** `asOf` returns what the system believed at any past
instant. Useful for auditing, debugging and "why did the agent say that?".

**A dashboard you can actually debug with.** Every extracted fact, every entity,
every episode, and a playground that shows the real HTTP traffic of the pipeline
as it runs.

## What it is not

| Not                               | Because                                                                                                        |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **A vector database**             | It uses pgvector internally, but you don't put documents in it and get chunks out.                             |
| **A RAG pipeline over your docs** | There is no document ingestion. The only input is conversation messages.                                       |
| **A hosted service**              | Self-host only. You run the Postgres and you bring the model API key.                                          |
| **A general knowledge store**     | Extraction keeps facts about the dataset's subject only; assistant statements and world knowledge are dropped. |
| **Multi-model**                   | Gemini is currently wired in directly. See [Known limitations](#known-limitations).                            |

## When to use it

**Good fit**

- A chat product where the assistant should remember a returning user
- A support agent that should not re-ask what it was told last week
- Anything where user preferences, constraints and decisions accumulate over
  many sessions
- Cases where you need to explain _why_ the model knew something, provenance is
  stored for every fact

**Poor fit today**

- Workflows where facts must come from _assistant_-role output, only the
  `user`-role speaker's statements are kept
- Anything needing immediate write-to-readable latency; extraction is
  asynchronous by design, batching a whole conversation into one LLM pass
  instead of paying per message
- Knowledge-base search over documents

## The three layers

Memory Soda derives three kinds of memory from the same message stream. You
mostly interact with the first and third.

| Layer                                  | Holds                                        | Read with                           | Cost                               |
| -------------------------------------- | -------------------------------------------- | ----------------------------------- | ---------------------------------- |
| [Working](/concepts/working-memory/)   | the live conversation window, auto-compacted | `prepare()`                         | pure SQL, milliseconds             |
| [Episodic](/concepts/episodic-memory/) | a summary of each chunk of a thread          | `recall({ include: ['episodes'] })` | one vector search                  |
| [Semantic](/concepts/semantic-memory/) | durable subject–predicate–object facts       | `recall()`                          | embedding + three parallel queries |

Read [How it works](/introduction/how-it-works/) for the full flow.

## Known limitations

**No write API.** There is no `add()` that takes a fact. Memory can only be
_derived_ from messages appended to a thread. If you already know something
about a user, you cannot tell the system directly.

**One subject per dataset.** Extraction enforces that the subject of every
fact is the literal string `user`, meaning the dataset's subject, whoever
speaks in the `user` role. Assistant statements and world knowledge are
dropped by design. Memory Soda is user-first because remembering people is
what it is built and tuned for, but `dataset` is a free partition you can
point at any conversing subject.

**Extraction is deferred.** A statement becomes retrievable once its thread is
ended, superseded by a new thread for the same dataset, or idle for 30 minutes,
then an episode summarisation call, a graph extraction call and a
contradiction-judging call run. Call `endThread()` when you want it sooner.

**Scope is `(project, dataset)` only.** There is no finer-grained notion of an
agent or a run built in; if you need one, encode it into your `dataset` key.

**No bulk delete of individual facts.** `deleteFact()` takes one `factId` at a
time; there is no "delete these facts" batch call. Erasing an entire dataset is
a single call, `forgetDataset()`, see
[Privacy and data deletion](/operations/privacy-and-deletion/).

**Gemini is hard-wired.** `GOOGLE_GENERATIVE_AI_API_KEY` is required to boot at
all, the model IDs are constants, and the 768-dimension embedding size is baked
into the schema.

**Memory never shrinks.** There is no forgetting, decay or consolidation pass.
Superseded facts stay in the table indefinitely.

## Next

- [How it works](/introduction/how-it-works/), the write path and the read path in detail
- [Installation](/getting-started/installation/), get it running

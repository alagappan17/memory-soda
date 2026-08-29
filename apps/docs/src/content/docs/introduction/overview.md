---
title: "Overview"
description: "Memory Soda gives an LLM application durable memory about its users."
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

---

## The problem it solves

An LLM has no memory between calls. The usual fixes both break down:

- **Send the whole history every turn.** Costs grow linearly, latency grows with
  them, and past a few thousand turns it stops fitting at all.
- **Embed everything and do RAG over the transcript.** You retrieve *messages*,
  not *knowledge*. "I moved to Berlin" and "I moved to Lisbon last month" both
  come back with similar scores, and the model has to guess which is current.

Memory Soda stores **claims, not transcripts**. Each claim carries the window of
time it is true for, so a contradiction supersedes rather than accumulates.

---

## What you get

**A prompt-ready context block.** Not embeddings, not JSON you have to format,
a string you paste into your system prompt.

```
Known facts about the user, most relevant first.

# FACTS  (format: fact (valid: from – to))
- user is interested in dji osmo pocket 3  (valid: 2026-08-15 – present)
- user finds too bulky mirrorless cameras  (valid: 2026-08-15 – present)
- user lives in berlin  (valid: 2026-03-01 – present)

# ENTITIES
- dji osmo pocket 3 (PRODUCT)
- berlin (PLACE)
```

**Contradiction handling.** When a user says something that conflicts with a
stored fact, an LLM judge decides which one survives. The loser is marked
superseded, not deleted, the history stays queryable.

**Time-travel queries.** `asOf` returns what the system believed at any past
instant. Useful for auditing, debugging and "why did the agent say that?".

**A dashboard you can actually debug with.** Every extracted fact, every entity,
every episode, and a playground that shows the real HTTP traffic of the pipeline
as it runs.

---

## What it is not

Be clear about this before adopting it.

| Not | Because |
|---|---|
| **A vector database** | It uses pgvector internally, but you don't put documents in it and get chunks out. |
| **A RAG pipeline over your docs** | There is no document ingestion. The only input is conversation messages. |
| **A hosted service** | Self-host only. You run the Postgres and you bring the model API key. |
| **A general knowledge store** | Extraction is deliberately constrained to facts *about the user*. See below. |
| **Multi-model** | Gemini is currently wired in directly. See [Known limitations](#known-limitations). |

---

## When to use it

**Good fit**

- A chat product where the assistant should remember a returning user
- A support agent that should not re-ask what it was told last week
- Anything where user preferences, constraints and decisions accumulate over
  many sessions
- Cases where you need to explain *why* the model knew something, provenance is
  stored for every fact

**Poor fit today**

- Multi-agent workflows that need to record what an *agent* learned, not what a
  *user* said, every extracted fact must have the user as its subject
- Anything needing sub-second write-to-readable latency; extraction is
  asynchronous and takes tens of seconds
- Knowledge-base search over documents

---

## The three layers

Memory Soda derives three kinds of memory from the same message stream. You
mostly interact with the first and third.

| Layer | Holds | Read with | Cost |
|---|---|---|---|
| [Working](/concepts/working-memory/) | the live conversation window, auto-compacted | `prepare()` | pure SQL, milliseconds |
| [Episodic](/concepts/episodic-memory/) | a summary of each chunk of a thread | `recall({ include: ['episodes'] })` | one vector search |
| [Semantic](/concepts/semantic-memory/) | durable subject–predicate–object facts | `recall()` | embedding + three parallel queries |

Read [How it works](/introduction/how-it-works/) for the full flow.

---

## Known limitations

Documented honestly, because you will hit these.

**No write API.** There is no `add()` that takes a fact. Memory can only be
*derived* from messages appended to a thread. If you already know something
about a user, you cannot tell the system directly.

**Every fact must be about the user.** Extraction enforces that the subject of
every fact is the literal string `user`. Facts about a project, a codebase, a
task or an agent are dropped by design. This makes it a personal-memory store,
not a general agent-memory store.

**Extraction is slow.** A statement becomes retrievable roughly 20–60 seconds
after the user stops typing: an inactivity timer, then an episode summarisation
call, then a graph extraction call, then a contradiction-judging call.

**Scope is `(project, dataset)` only.** There is no notion of an agent or a run,
so there is nowhere to put memory belonging to a particular workflow execution.

**No bulk delete.** Facts can be soft-deleted one at a time. There is no
`DELETE /datasets/:id` for a full erasure request. See
[Privacy and data deletion](/operations/privacy-and-deletion/).

**Gemini is hard-wired.** `GOOGLE_GENERATIVE_AI_API_KEY` is required to boot at
all, the model IDs are constants, and the 768-dimension embedding size is baked
into the schema.

**Memory never shrinks.** There is no forgetting, decay or consolidation pass.
Superseded facts stay in the table indefinitely.

---

## Next

- [How it works](/introduction/how-it-works/), the write path and the read path in detail
- [Installation](/getting-started/installation/), get it running

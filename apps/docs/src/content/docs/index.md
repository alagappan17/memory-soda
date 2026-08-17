---
title: memory-soda
description: A self-hostable memory layer for AI agents. Extract durable facts from conversations, resolve contradictions over time, and recall prompt-ready context.
template: splash
# Starlight appends the site title to every page title, which would make the
# homepage "memory-soda | memory-soda". Override the tag outright.
head:
  - tag: title
    content: memory-soda — a memory layer for AI agents
hero:
  tagline: A self-hostable memory layer for AI agents. Postgres and pgvector are the only infrastructure.
  actions:
    - text: Get started
      link: /getting-started/installation/
      icon: right-arrow
      variant: primary
    - text: How it works
      link: /introduction/how-it-works/
      icon: open-book
      variant: minimal
    - text: GitHub
      link: https://github.com/alagappan17/memory-soda
      icon: external
      variant: minimal
---

## What it does

You send it conversations. It works out which statements are worth keeping,
resolves them against what it already believes, and hands back a prompt-ready
block of text before your next model call.

```ts
import { MemorySodaClient } from '@memory-soda/sdk';

const memory = new MemorySodaClient({
  baseUrl: 'http://localhost:3004',
  apiKey: process.env.MEMORY_SODA_API_KEY!,
});

// Before the model call — what do we know about this user?
const { context } = await memory.recall({ dataset: 'user_42', query: userMessage });

// After the turn — hand us the conversation, we work out what's worth keeping.
await memory.workingMemory.addMessage(threadId, { role: 'user', content: userMessage });
await memory.workingMemory.addMessage(threadId, { role: 'assistant', content: reply });
```

`context` is a string. It goes straight into your system prompt.

```
Known facts about the user, most relevant first.

# FACTS  (format: fact (valid: from – to))
- user is interested in dji osmo pocket 3  (valid: 2026-08-16 – present)
- user finds too bulky mirrorless cameras  (valid: 2026-08-16 – present)
- user lives in berlin  (valid: 2026-03-01 – present)
```

## Why not just send the whole history

Two usual fixes both break down. Sending every turn costs more each time and
eventually stops fitting. Embedding the transcript retrieves *messages*, not
*knowledge* — "I moved to Berlin" and "I moved to Lisbon last month" come back
with similar scores and the model has to guess which is current.

memory-soda stores **claims, not transcripts**. Each claim carries the window of
time it is true for, so a contradiction supersedes rather than accumulates.

## Start here

| | |
|---|---|
| [Overview](/introduction/overview/) | What this is, what it is not, and the known limitations |
| [How it works](/introduction/how-it-works/) | The write path and the read path in detail |
| [Installation](/getting-started/installation/) | Prerequisites through first boot |
| [Quickstart](/getting-started/quickstart/) | Store and recall your first memory |
| [Your first integration](/getting-started/your-first-integration/) | A complete chat turn with your own model |

## Reference

| | |
|---|---|
| [SDK](/sdk/) | Every method and every exported type |
| [HTTP API](/api/) | Every endpoint, with request and response bodies |
| [Dashboard](/dashboard/) | The bundled UI, including the playground |
| [Concepts](/concepts/projects-and-datasets/) | The memory model, bi-temporal facts, retrieval |
| [Operations](/operations/self-hosting/) | Self-hosting, migrations, background jobs, privacy |

## Status

Pre-1.0 and self-hosted only. There is no hosted offering.

The documentation describes what exists today, including the parts that are
smaller or rougher than they should be — see
[Known limitations](/introduction/overview/#known-limitations) for an honest
list of what is missing and what is likely to change.

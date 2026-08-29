---
title: "Quickstart"
description: "Store your first memory and read it back. Assumes you have completed Installation and the API is running on port 3004."
---
Store your first memory and read it back. Assumes you have completed
[Installation](/getting-started/installation/) and the API is running on port 3004.

---

## With the SDK

```bash
npm install @alagappan17/memory-soda
```

```ts
import { MemorySoda } from '@alagappan17/memory-soda';

const memory = new MemorySoda({
  baseUrl: 'http://localhost:3004',
  apiKey: process.env.MEMORY_SODA_API_KEY!,
});

// 1. A thread groups the messages of one conversation.
//    `dataset` is the stable identity of the person you're remembering.
const { threadId } = await memory.createThread({ dataset: 'user_42' });

// 2. Append a conversation. This is all extraction ever sees.
await memory.addMessage(threadId, {
  role: 'user',
  content: "I'm looking for a family car under $30k. It has to be easy to park, SUVs are too big for me.",
});
await memory.addMessage(threadId, {
  role: 'assistant',
  content: 'The Toyota Corolla Hybrid is a great fit, 50 mpg, roomy boot, easy to park.',
});
await memory.addMessage(threadId, {
  role: 'user',
  content: 'Yeah the corola hybrid looks great. I mostly do city commutes.',
});

// 3. Extraction is asynchronous. Give it a moment.
//    (Default: ~10s of inactivity, then the pipeline runs.)
await new Promise((r) => setTimeout(r, 45_000));

// 4. Read it back.
const { context, factCount } = await memory.recall({
  dataset: 'user_42',
  query: 'what car should I recommend?',
});

console.log(`${factCount} facts`);
console.log(context);
```

Expected output:

```
4 facts
Known facts about the user, most relevant first.

# FACTS  (format: fact (valid: from – to))
- user is interested in toyota corolla hybrid  (valid: 2026-08-16 – present)
- user finds too big suvs  (valid: 2026-08-16 – present)
- user does city commuting  (valid: 2026-08-16 – present)
- user wants a family car that is easy to park, under $30k  (valid: 2026-08-16 – present)

# ENTITIES
- toyota corolla hybrid (PRODUCT)
- suvs (PRODUCT)
- city commuting (TOPIC)
```

That `context` string goes straight into your system prompt. That is the whole
integration.

> **Why the wait?** Extraction runs in the background after a period of
> inactivity, three LLM calls and two embedding batches. See
> [How it works](/introduction/how-it-works/#the-write-path). To watch it
> happen live, use the [Playground](/dashboard/playground/).

---

## With curl

```bash
export KEY=ms_your_key_here
export API=http://localhost:3004
```

**Create a thread**

```bash
THREAD=$(curl -s -X POST $API/v1/threads \
  -H "Authorization: Bearer $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"dataset":"user_42"}' | jq -r .threadId)
```

**Append a message**

```bash
curl -s -X POST $API/v1/memory/working/threads/$THREAD/messages \
  -H "Authorization: Bearer $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"role":"user","content":"I bought a Tesla Model 3 last month and I am still learning Autopilot."}'
```

**Recall**

```bash
curl -s -X POST $API/v1/memory/recall \
  -H "Authorization: Bearer $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"dataset":"user_42","query":"where does the user live?"}' | jq -r .context
```

---

## Skipping the wait

Extraction normally waits for a lull in conversation. To force it immediately:

```ts
await memory.endThread(threadId);
```

Despite the name, this does not close the thread, it remains writable. It just
queues extraction now instead of on the timer. See
[`threads.end()`](/sdk/threads/#endthread).

---

## What just happened

| Step | Stored |
|---|---|
| `threads.create` | a row in `threads`, scoped to your project and the `dataset` string |
| `addMessage` ×3 | three rows in `messages` with sequence numbers 1, 2, 3 |
| the wait | an `episodes` row, then four `facts` rows and three `entities` rows |
| `recall` | nothing, a pure read |

Open the dashboard's [Datasets](/dashboard/datasets/) page and select
`user_42` to see all of it.

---

## Next

- [Your first integration](/getting-started/your-first-integration/), a complete chat turn with an LLM
- [Build a chatbot with memory](/guides/build-a-chatbot/), the full worked example
- [Playground](/dashboard/playground/), watch the pipeline run in real time

# Quickstart

Store your first memory and read it back. Assumes you have completed
[Installation](./installation.md) and the API is running on port 3004.

---

## With the SDK

```bash
npm install @memory-soda/sdk
```

```ts
import { MemorySodaClient } from '@memory-soda/sdk';

const memory = new MemorySodaClient({
  baseUrl: 'http://localhost:3004',
  apiKey: process.env.MEMORY_SODA_API_KEY!,
});

// 1. A thread groups the messages of one conversation.
//    `dataset` is the stable identity of the person you're remembering.
const { threadId } = await memory.threads.create({ dataset: 'user_42' });

// 2. Append a conversation. This is all extraction ever sees.
await memory.workingMemory.addMessage(threadId, {
  role: 'user',
  content: "I'm looking for a travel camera under $1000. It has to be small — mirrorless is too bulky for me.",
});
await memory.workingMemory.addMessage(threadId, {
  role: 'assistant',
  content: 'The DJI Osmo Pocket 3 is a great fit — 1-inch sensor, built-in gimbal, pocketable.',
});
await memory.workingMemory.addMessage(threadId, {
  role: 'user',
  content: 'Yeah the pocket 3 looks great. I mostly shoot travel vlogs.',
});

// 3. Extraction is asynchronous. Give it a moment.
//    (Default: ~10s of inactivity, then the pipeline runs.)
await new Promise((r) => setTimeout(r, 45_000));

// 4. Read it back.
const { context, factCount } = await memory.recall({
  dataset: 'user_42',
  query: 'what camera should I recommend?',
});

console.log(`${factCount} facts`);
console.log(context);
```

Expected output:

```
4 facts
Known facts about the user, most relevant first.

# FACTS  (format: fact (valid: from – to))
- user is interested in dji osmo pocket 3  (valid: 2026-08-16 – present)
- user finds too bulky mirrorless cameras  (valid: 2026-08-16 – present)
- user shoots travel vlogging  (valid: 2026-08-16 – present)
- user wants a travel camera that is small, under $1000  (valid: 2026-08-16 – present)

# ENTITIES
- dji osmo pocket 3 (PRODUCT)
- mirrorless cameras (PRODUCT)
- travel vlogging (TOPIC)
```

That `context` string goes straight into your system prompt. That is the whole
integration.

> **Why the wait?** Extraction runs in the background after a period of
> inactivity — three LLM calls and two embedding batches. See
> [How it works](../introduction/how-it-works.md#the-write-path). To watch it
> happen live, use the [Playground](../dashboard/playground.md).

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
  -d '{"role":"user","content":"I moved to Berlin last month and I am learning German."}'
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
await memory.threads.end(threadId);
```

Despite the name, this does not close the thread — it remains writable. It just
queues extraction now instead of on the timer. See
[`threads.end()`](../sdk/threads.md#end).

---

## What just happened

| Step | Stored |
|---|---|
| `threads.create` | a row in `threads`, scoped to your project and the `dataset` string |
| `addMessage` ×3 | three rows in `messages` with sequence numbers 1, 2, 3 |
| the wait | an `episodes` row, then four `facts` rows and three `entities` rows |
| `recall` | nothing — a pure read |

Open the dashboard's [Datasets](../dashboard/datasets.md) page and select
`user_42` to see all of it.

---

## Next

- [Your first integration](./your-first-integration.md) — a complete chat turn with an LLM
- [Build a chatbot with memory](../guides/build-a-chatbot.md) — the full worked example
- [Playground](../dashboard/playground.md) — watch the pipeline run in real time

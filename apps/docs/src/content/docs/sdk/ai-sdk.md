---
title: 'AI SDK integration'
description: 'Wire memory into generateText, streamText and agent loops through a language-model middleware.'
---

Memory Soda ships a subpath for the [Vercel AI SDK](https://sdk.vercel.ai):

```ts
import {
  memoryMiddleware,
  memoryTool,
  toMemoryMessages,
} from '@memory-soda/sdk/ai';
```

It is a separate entry point, so importing the client never pulls in code that
only makes sense alongside `ai`.

## The middleware

`wrapLanguageModel` gives a memory layer exactly the two seams it needs:
`transformParams` runs before the provider call and can add to the prompt, and
`wrapGenerate` / `wrapStream` see the finished turn and can write it down.
Wrapping the model instead of every call site means memory behaves the same in
`generateText`, `streamText`, and any agent loop built on them.

```ts
import { google } from '@ai-sdk/google';
import { generateText, wrapLanguageModel } from 'ai';
import { MemorySoda } from '@memory-soda/sdk';
import { memoryMiddleware } from '@memory-soda/sdk/ai';

const memory = new MemorySoda();
const { threadId, dataset } = await memory.createThread({ dataset: 'u_42' });

const model = wrapLanguageModel({
  model: google('gemini-2.5-flash'),
  middleware: memoryMiddleware({ memory, dataset, threadId }),
});

// Recalls before the call, records the turn after it.
const { text } = await generateText({ model, prompt: 'What should I cook?' });
```

### Options

| Option            | Default                           | What it does                                                                                                |
| ----------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `memory`          | ,                                 | The client to use. Required.                                                                                |
| `dataset`         | ,                                 | Whose memory this is. Required.                                                                             |
| `threadId`        | ,                                 | Thread to append to. A string, or a function resolving one per call. Omit it and the middleware only reads. |
| `recall`          | `true`                            | Inject recalled context into the system prompt.                                                             |
| `write`           | `true` when a thread is available | Record the finished turn.                                                                                   |
| `limit`           | project setting                   | Facts to retrieve.                                                                                          |
| `includeEpisodes` | `false`                           | Also inject cross-thread episode summaries.                                                                 |
| `recallTimeoutMs` | `2000`                            | Cap on how long recall may delay a model call.                                                              |
| `onError`         | `console.warn`                    | Called when recall or the write-back fails.                                                                 |

### Two guarantees

**A recall failure never fails the call.** If memory is down, slow, or empty,
`transformParams` returns the prompt untouched and the model answers without
context. The timeout is part of this: past `recallTimeoutMs` the call proceeds
regardless, because a slow answer with context is worse than a fast one without.

**The write-back never blocks the response.** It is fired and forgotten, with
failures routed to `onError`. On `streamText` only the prompt is recorded at
call time, the assistant's reply arrives on the next turn's prompt, so the
write stays off the streaming path entirely.

### Resolving a thread lazily

Memory is written through threads, so writing needs one. For a chat app you
usually already have a thread per conversation. For anything that starts
without one, pass a function:

```ts
let threadId: string | undefined;

memoryMiddleware({
  memory,
  dataset,
  threadId: async () => {
    threadId ??= (await memory.createThread({ dataset })).threadId;
    return threadId;
  },
});
```

Cache it as shown, a function that creates a thread on every call produces one
thread per turn, and each thread's episode then sees a single message.

## The tool

The middleware recalls on every turn, which is right for a chat assistant and
wasteful for an agent that mostly runs tools. A tool inverts it: the model
decides when a lookup is worth a round trip, and says what it is looking for,
usually a better retrieval query than the raw user message.

```ts
import { memoryTool } from '@memory-soda/sdk/ai';

const { text } = await generateText({
  model: google('gemini-2.5-flash'),
  tools: { recallMemory: memoryTool({ memory, dataset }) },
  prompt: 'Book me the usual table.',
});
```

The tool returns the rendered context block as a string. When nothing matches
it returns a plain sentence saying so, rather than an error, "nothing known" is
an answer the model should act on, not a failure it should retry.

You can use both: the middleware for ambient personalisation, the tool for
deliberate lookups.

## The message bridge

The AI SDK models a message as a role plus an array of parts. Memory stores
text. `toMemoryMessages` flattens one into the other:

```ts
import { toMemoryMessages } from '@memory-soda/sdk/ai';

await memory.addMessages(threadId, toMemoryMessages(messages));
```

The middleware uses this internally; call it directly when you are writing to
memory yourself, from an `onFinish` handler, say.

**Tool calls and results are kept, not dropped.** A turn where the agent looked
something up and got an answer back is often the only durable fact in it, and an
agent that silently forgets its own tool use is the failure this package exists
to prevent. They render as `[called getProfile({"id":"42"})]` and
`[getProfile returned {"tier":"gold"}]`.

Messages that flatten to nothing, a bare file attachment, an empty assistant
turn, are skipped rather than stored blank, and roles memory does not model are
skipped rather than coerced.

## Doing it by hand

The middleware is a convenience. Under it, the loop is two calls:

```ts
const { context } = await memory.recall({ dataset, query: userInput });

const { text } = await generateText({
  model: google('gemini-2.5-flash'),
  system: context ? `What you know about this user:\n${context}` : undefined,
  prompt: userInput,
});

await memory.addMessages(threadId, [
  { role: 'user', content: userInput },
  { role: 'assistant', content: text },
]);
```

Reach for this when you want the context block somewhere other than the system
prompt, or when you are not using the AI SDK at all.

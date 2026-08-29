# @alagappan17/memory-soda

Memory for AI agents. Your app has the conversation; this remembers what it
revealed and hands it back before the next model call.

Self-hosted, Postgres-backed, no dependencies.

```bash
npm install @alagappan17/memory-soda
```

Node 18+ (uses global `fetch` and `AbortSignal.timeout`). ESM and CJS. Types
bundled.

---

## Quick start

```ts
import { MemorySoda } from '@alagappan17/memory-soda';

const memory = new MemorySoda({
  baseUrl: 'http://localhost:3004',
  apiKey: 'ms_…',
});
```

Or set `MEMORY_SODA_BASE_URL` and `MEMORY_SODA_API_KEY` and call
`new MemorySoda()` with no arguments.

### The loop

Memory is written by having the conversation and read by asking for it back.
There is no "extract" call — facts are pulled out in the background, a few
seconds after a burst of messages.

```ts
// Once per conversation. `dataset` is whose memory this is; a user id works.
const { threadId, dataset } = await memory.createThread({ dataset: 'user_42' });

// Every turn: write what was said…
await memory.addMessage(threadId, { role: 'user', content: input });

// …and read what matters, as a prompt-ready block.
const { context } = await memory.recall({ dataset, query: input });

const reply = await yourModel({
  system: context ? `What you know about this user:\n${context}` : undefined,
  prompt: input,
});

await memory.addMessage(threadId, { role: 'assistant', content: reply });
```

`context` is text, ready to paste into a system prompt:

```
Known facts about the user, most relevant first.

# FACTS  (format: fact (valid: from – to))
- user wants a car that is fun to drive  (valid: 2026-07-05 – present)
- user finds too big suvs  (valid: 2026-07-05 – present)

# ENTITIES
- toyota corolla hybrid (PRODUCT)
```

---

## With the Vercel AI SDK

Wrap the model once and memory becomes invisible — it recalls before every call
and records every turn, in `generateText`, `streamText`, and any agent loop
built on them.

```ts
import { google } from '@ai-sdk/google';
import { generateText, wrapLanguageModel } from 'ai';
import { memoryMiddleware } from '@alagappan17/memory-soda/ai';

const model = wrapLanguageModel({
  model: google('gemini-2.5-flash'),
  middleware: memoryMiddleware({ memory, dataset, threadId }),
});

const { text } = await generateText({ model, prompt: 'What should I cook?' });
```

Two things it guarantees, because breaking either makes it worse than no memory:
a recall failure degrades to an unaugmented call rather than throwing, and the
write-back never blocks the response.

For agents that should decide when to look something up:

```ts
import { memoryTool } from '@alagappan17/memory-soda/ai';

await generateText({
  model: google('gemini-2.5-flash'),
  tools: { recallMemory: memoryTool({ memory, dataset }) },
  prompt: 'Book me the usual table.',
});
```

And `toMemoryMessages()` converts AI SDK messages — parts, tool calls, tool
results and all — into what memory stores, if you would rather write the
persistence yourself.

---

## The surface

Every method is on the client itself. The names carry the tiering — what a chat
turn calls is short, what you reach for occasionally is compound.

```
memory
│
│  every turn
├── addMessage · prepare · recall · prepareAndRecall
│
│  conversations
├── createThread · getThread · updateThread · endThread
├── addMessages · listMessages · compact
│
│  what was learned
├── listFacts · deleteFact · listEntities
├── listEpisodes · searchEpisodes · getEpisode
│
│  whole datasets
├── exportDataset · forgetDataset
│
└── health
```

```ts
await memory.listFacts('user_42');            // what is known, most recent first
await memory.deleteFact('user_42', factId);  // retire something we got wrong
await memory.exportDataset('user_42');       // everything held, for a SAR
await memory.forgetDataset('user_42');       // erase it, for real
```

Facts are bi-temporal: `validAt`/`validUntil` is when something is true in the
world, `invalidAt` is when the system stopped believing it. That is what makes
point-in-time recall work:

```ts
await memory.recall({ dataset, query, asOf: '2026-01-01' });
```

---

## Configuration

```ts
new MemorySoda({
  baseUrl: 'https://memory.example.com',
  apiKey: 'ms_…',
  timeout: 30_000,     // per request, default 60s
  maxRetries: 2,       // for 429, 5xx and network failures. Default 2.
  onRequest: ({ method, path }) => log(method, path),
  onResponse: ({ status, durationMs }) => log(status, durationMs),
});
```

Retries use exponential backoff with jitter and never apply to a 4xx — a bad
request will not get better by asking again.

> **Server-side only.** An API key grants full read and write access to every
> dataset in its project. Never ship it to a browser or a mobile app.

---

## Errors

| Class | When |
|---|---|
| `AuthError` | 401 or 403 — missing, invalid, or revoked key |
| `ApiError` | any other non-2xx; carries `status` and `body` |
| `NetworkError` | the request never got a response |

All extend `MemorySodaError`.

---

## Running the server

Requires PostgreSQL with the [pgvector](https://github.com/pgvector/pgvector)
extension.

```bash
npm create memory-soda@latest
```

Or from source:

```bash
git clone https://github.com/alagappan17/memory-soda
cd memory-soda
npm install
cp .env.example .env    # set DATABASE_URL and GOOGLE_GENERATIVE_AI_API_KEY
npm run db:migrate
npm run dev             # API on :3004, dashboard on :3000
```

Create an API key in the dashboard under **API Keys**. It is shown once.

Full documentation: [github.com/alagappan17/memory-soda](https://github.com/alagappan17/memory-soda)

MIT licensed.

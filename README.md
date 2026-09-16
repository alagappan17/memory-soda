# Memory Soda

Semantic memory layer for AI agents. Extract facts from conversations, store them in Postgres, and retrieve relevant context for future LLM calls. Powered by pgvector similarity search. Self-hostable.

[Documentation](https://memorysoda.alagappan.dev) · [Quickstart](https://memorysoda.alagappan.dev/getting-started/quickstart/) · [SDK reference](https://memorysoda.alagappan.dev/sdk/) · [HTTP API reference](https://memorysoda.alagappan.dev/api/)

---

## How it works

You send conversations. Memory Soda figures out which statements are worth
keeping, resolves them against what it already believes, and gives you back a
prompt-ready block of text before your next model call.

```
┌──────────────┐   messages    ┌──────────────┐   facts    ┌──────────────┐
│  Your app    │ ────────────► │ Memory Soda  │ ─────────► │  Postgres    │
│              │ ◄──────────── │              │ ◄───────── │  + pgvector  │
└──────────────┘   context     └──────────────┘  retrieval └──────────────┘
```

Facts are extracted in the background — you never call an "extract" endpoint.
A few seconds after a burst of messages, `recall()` starts returning what the
conversation revealed. Read more in [How it works](https://memorysoda.alagappan.dev/introduction/how-it-works/) and [Architecture](https://memorysoda.alagappan.dev/introduction/architecture/).

---

## Quickstart

```bash
npm create memory-soda@latest
```

The installer walks you through Postgres setup, a Gemini API key, ports, and
migrations — then you're ready to `npm run dev`.

> **Prerequisites:** Node 20+ and PostgreSQL with the [pgvector](https://github.com/pgvector/pgvector) extension.

For the full walkthrough including Docker-based Postgres and manual setup, see the [Installation guide](https://memorysoda.alagappan.dev/getting-started/installation/).

---

## Use the SDK

```bash
npm install @memory-soda/sdk
```

```ts
import { MemorySoda } from '@memory-soda/sdk';

const memory = new MemorySoda({
  baseUrl: 'http://localhost:3004',
  apiKey: 'ms_xxxx',
});

// Create a thread for a conversation
const { threadId } = await memory.createThread({ dataset: 'user_42' });

// Write what was said
await memory.addMessage(threadId, { role: 'user', content: input });

// Read what matters — a prompt-ready block
const { context } = await memory.recall({ dataset: 'user_42', query: input });

const reply = await yourModel({
  system: context ? `What you know about this user:\n${context}` : undefined,
  prompt: input,
});

await memory.addMessage(threadId, { role: 'assistant', content: reply });
```

Or set `MEMORY_SODA_BASE_URL` and `MEMORY_SODA_API_KEY` and call
`new MemorySoda()` with no arguments.

> **Server-side only.** An API key grants full read and write access to every
> dataset in its project. Never ship it to a browser or a mobile app.

For the full SDK reference, integration patterns, and the Vercel AI SDK middleware, see the [SDK docs](https://memorysoda.alagappan.dev/sdk/) and [Your first integration](https://memorysoda.alagappan.dev/getting-started/your-first-integration/).

---

## Local development

```bash
npm run dev   # API + Dashboard, hot reload
```

| Service   | URL                          |
| --------- | ---------------------------- |
| Dashboard | http://localhost:3000        |
| API       | http://localhost:3004        |
| Status    | http://localhost:3000/status |

Sign in to the dashboard with `admin` / `open-sesame` and change the password
when prompted.

| Command               | Description                              |
| --------------------- | ---------------------------------------- |
| `npm run dev`         | Start API + Dashboard in watch mode      |
| `npm run build`       | Build all projects                       |
| `npm run typecheck`   | Type-check all projects                  |
| `npm run test`        | Run the test suites                      |
| `npm run lint`        | Lint everything                          |
| `npm run db:migrate`  | Apply pending migrations                 |
| `npm run db:generate` | Generate a migration from schema changes |

For contributor setup, testing, and release workflows, see the [Contributing docs](https://memorysoda.alagappan.dev/contributing/development/).

---

## Project structure

```
apps/
  api/          ← Express API: memory pipeline, Drizzle schema, worker
  dashboard/    ← Vite + React dashboard and playground
  docs/         ← Astro Starlight documentation site

packages/
  sdk/          ← @memory-soda/sdk — install this in your app
  types/        ← shared types and settings defaults (internal)
  create-memory-soda/ ← the `npm create memory-soda` installer
```

---

## Configuration

Copy `.env.example` to `.env` in the repo root. The two required variables:

| Variable                       | Description                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini API key — [get one at aistudio.google.com](https://aistudio.google.com) |
| `DATABASE_URL`                 | Postgres connection string (database must have the `vector` extension)         |

For the full list of environment variables and project settings, see [Configuration](https://memorysoda.alagappan.dev/getting-started/configuration/) and [Environment variables reference](https://memorysoda.alagappan.dev/reference/environment-variables/).

---

## Deployment

Memory Soda is self-hosted only — there is no managed offering. See the
[Self-hosting guide](https://memorysoda.alagappan.dev/operations/self-hosting/) for sizing, container setup, and production recommendations.

---

## Documentation

The full documentation lives at **[memorysoda.alagappan.dev](https://memorysoda.alagappan.dev)** and covers:

- **[Introduction](https://memorysoda.alagappan.dev/introduction/overview/)** — overview, how it works, architecture
- **[Getting started](https://memorysoda.alagappan.dev/getting-started/installation/)** — installation, quickstart, first integration, configuration
- **[Concepts](https://memorysoda.alagappan.dev/concepts/projects-and-datasets/)** — working / episodic / semantic memory, bi-temporal model, extraction pipeline, retrieval
- **[SDK reference](https://memorysoda.alagappan.dev/sdk/)** — client, threads, messages, facts, datasets, AI SDK integration, errors, types
- **[HTTP API](https://memorysoda.alagappan.dev/api/)** — conventions, authentication, threads, recall, semantic/episodic memory
- **[Dashboard](https://memorysoda.alagappan.dev/dashboard/)** — projects, API keys, datasets, playground, settings, usage
- **[Guides](https://memorysoda.alagappan.dev/guides/build-a-chatbot/)** — build a chatbot, long conversations, curating memory, point-in-time recall, tuning retrieval
- **[Operations](https://memorysoda.alagappan.dev/operations/self-hosting/)** — self-hosting, migrations, background jobs, privacy & data deletion
- **[Reference](https://memorysoda.alagappan.dev/reference/environment-variables/)** — environment variables, database schema, project settings, errors, limits
- **[Contributing](https://memorysoda.alagappan.dev/contributing/development/)** — development setup, testing, releasing

---

## License

[MIT](./LICENSE)

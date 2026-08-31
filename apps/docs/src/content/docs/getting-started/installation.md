---
title: 'Installation'
description: 'Memory Soda is self-hosted. You run Postgres, you bring a Gemini API key.'
---

Memory Soda is self-hosted. You run Postgres, you bring a Gemini API key.

## Install

```bash
npm create memory-soda@latest
```

The installer is the one supported way to set up a self-hosted instance. It
checks each requirement before it asks you to use it, creates what it can, and
finishes with a checklist of anything it could not do for you.

What it does, in order:

1. **Preflight** — Node 20+ and git. Missing? It prints the install command
   for your OS and stops; nothing is written. Re-run after installing.
2. **Folder** — `memory-soda` by default; must be empty or missing.
3. **Postgres** — pick one:
   - _I have one_ — give the URL (default `postgresql://localhost:5432/memory_db`)
   - _Start one in Docker for me_ — shown when Docker is running; starts
     `pgvector/pgvector:pg16` as `memory-soda-pg` with a generated password
   - _Skip_ — set `DATABASE_URL` yourself later
4. **Database check** — connects, offers to create a missing database, confirms
   pgvector is installed and runs `CREATE EXTENSION vector`. Every failure names
   the fix and lets you retry, paste another URL, or skip.
5. **Gemini key** — checked live against the API. Blank is allowed, but the API
   will not start until it is set.
6. **Ports** — checked for use. The dashboard login is always `admin` /
   `open-sesame` to start with; the installer reminds you to change it.
7. **Clone, `.env`, `npm ci`, migrations** — migrations run now if the
   database passed, otherwise they are left on the checklist.

It ends with a status block and a **Before you run** list, for example:

```
│ ✓ Postgres  postgresql://localhost:5432/memory_db
│ ✗ Gemini key missing
│ ✓ Migrations applied
│
│ Before you run
│ 1. Set GOOGLE_GENERATIVE_AI_API_KEY in .env — the API refuses to start without it
```

The project keeps its `.git` with the public repo as `upstream`, so
`npm run update` (`git pull upstream main && npm install`) brings in fixes.
Add your own repo as `origin` to deploy from it.
Pass `--verbose` to stream clone/install output instead of a spinner.

## Prerequisites

| Requirement    | Version     | Notes                                                                                                               |
| -------------- | ----------- | ------------------------------------------------------------------------------------------------------------------- |
| Node.js        | 20 or newer | 22+ recommended                                                                                                     |
| git            | any         |                                                                                                                     |
| PostgreSQL     | 14 or newer | must have the [pgvector](https://github.com/pgvector/pgvector) extension — or let the installer start one in Docker |
| Gemini API key |             | free tier is enough to evaluate, [aistudio.google.com](https://aistudio.google.com)                                 |

### Installing pgvector on your own Postgres

<details>
<summary>macOS (Homebrew)</summary>

```bash
brew install pgvector
# If you installed Postgres via Homebrew, that's it. Otherwise build from source:
#   git clone https://github.com/pgvector/pgvector && cd pgvector && make && sudo make install
```

</details>

<details>
<summary>Debian / Ubuntu</summary>

```bash
sudo apt install postgresql-16-pgvector   # match your server major version
```

</details>

Verify:

```bash
psql -d postgres -c "SELECT * FROM pg_available_extensions WHERE name = 'vector';"
```

> `CREATE EXTENSION` needs superuser on most installations. If the role in your
> URL lacks it, the installer puts the exact `psql` command on your checklist.

> Planning to send patches? Clone instead — see
> [Development setup](/contributing/development/).

## Start

```bash
npm run dev
```

This runs the API and the dashboard together with hot reload.

On **first boot only**, the admin user and a project named `default` are
created:

```
[ setup ] admin user "admin" created. Sign in to the dashboard and change the password.
```

Sign in with **`admin` / `open-sesame`**, change the password when the sidebar
asks you to, then create an API key under **API Keys**.

- The **API key** is hashed at rest and cannot be recovered. If you lose it,
  issue a new one from the dashboard's API Keys page.
- The **admin password** can be reset from the shell with
  `npm run admin:reset-password -- admin <new-password>`.

| Service      | URL                          |
| ------------ | ---------------------------- |
| Dashboard    | http://localhost:3000        |
| API          | http://localhost:3004        |
| Health check | http://localhost:3004/health |

## Verify

```bash
curl http://localhost:3004/health
```

```json
{ "status": "ok", "services": { "postgres": "ok" } }
```

Then sign in to the dashboard at http://localhost:3000 and open **Status**.

## Installing the SDK in your app

```bash
npm install @memory-soda/sdk
```

```ts
import { MemorySoda } from '@memory-soda/sdk';

const memory = new MemorySoda({
  baseUrl: 'http://localhost:3004',
  apiKey: 'ms_…',
});
```

### Environments

Install the SDK from npm in every environment. Only `baseUrl` changes: your
local API in development, your deployed API in production, so read it from
config rather than hard-coding it:

```ts
const memory = new MemorySoda({
  baseUrl: process.env.MEMORY_SODA_URL,
  apiKey: process.env.MEMORY_SODA_API_KEY,
});
```

## Troubleshooting

**`GOOGLE_GENERATIVE_AI_API_KEY environment variable is required but not set`**
The API throws at import time without it. It is required even for endpoints that
never call a model.

**`extension "vector" is not available`**
pgvector is not installed for your Postgres _major version_. Installing it for
16 does not help a 15 server.

**`Error: listen EADDRINUSE :::3004`**
Something is already on the port. `lsof -ti:3004 | xargs kill`, or set `PORT`.

**Dashboard starts on port 3001**
Vite fell back because 3000 was taken. Free it, or set `VITE_API_URL` in the
dashboard and update `CORS_ORIGIN` to match the port you land on.

**CORS errors in the browser**
`CORS_ORIGIN` must exactly match the dashboard's origin, including port. Multiple
origins are comma-separated.

**Migrations fail with a permissions error**
`memory_user` must own the database: `ALTER DATABASE memory_db OWNER TO memory_user;`

## Next

- [Quickstart](/getting-started/quickstart/), store and recall your first memory
- [Configuration](/getting-started/configuration/), every knob

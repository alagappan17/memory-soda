# create-memory-soda

Scaffold a self-hosted [memory-soda](https://github.com/alagappan17/memory-soda)
instance — API, dashboard, SDK, and a Postgres to point them at.

```bash
npm create memory-soda@latest
```

It asks for a folder name, a Gemini API key, your Postgres connection string,
which ports to use, and the dashboard admin login. Then it clones the repo,
writes `.env`, installs dependencies, and verifies the database.

```bash
cd memory-soda
npm run dev
```

First boot applies migrations, creates your admin user, and prints an API key
once. Dashboard on :3000, API on :3004.

## Postgres

You bring your own. The installer asks for a `DATABASE_URL`, probes the host and
port while you are still at the prompt, and after `npm install` connects for real
to confirm the database exists and pgvector is available.

When that check fails it names the fix and lets you retry without starting over:

```
! database "memory_db" does not exist
  createdb memory_db
Fix it and press enter to retry, or type a new DATABASE_URL (s to skip):
```

The role in the URL needs permission to `CREATE EXTENSION vector` — the first
migration creates the extension. On most installations that means a superuser.

## Requirements

Node 20+, git, and a Postgres 14+ with the pgvector extension available.

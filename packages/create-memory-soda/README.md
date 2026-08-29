# create-memory-soda

Scaffold a self-hosted [Memory Soda](https://github.com/alagappan17/memory-soda)
instance — API, dashboard, SDK, and a Postgres to point them at.

```bash
npm create memory-soda@latest
```

It asks for a folder name, a Gemini API key, your Postgres connection string,
which ports to use, and the dashboard admin login. Then it clones the repo,
writes `.env`, installs dependencies, creates the database if it is missing,
and verifies pgvector is available. Clone and install run behind a spinner;
pass `--verbose` to stream their full output instead.

```bash
cd memory-soda
npm run dev
```

First boot applies migrations, creates your admin user, and prints an API key
once. Dashboard on :3000, API on :3004.

## Postgres

You bring the server; the installer creates the database. It asks for a
`DATABASE_URL`, probes the host and port while you are still at the prompt, and
after install connects for real. A missing database is created for you (the
role in the URL needs `CREATEDB`). Anything else — server down, bad password,
no pgvector — names the fix and lets you retry without starting over.

The role in the URL needs permission to `CREATE EXTENSION vector` — the first
migration creates the extension. On most installations that means a superuser.

## Requirements

Node 20+, git, and a Postgres 14+ with the pgvector extension available.

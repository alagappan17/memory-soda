# create-memory-soda

Scaffold a self-hosted [memory-soda](https://github.com/alagappan17/memory-soda)
instance — API, dashboard, SDK, and a Postgres to point them at.

```bash
npm create memory-soda@latest
```

It asks for a folder name, a Gemini API key, how you want Postgres, and the
dashboard admin login. Then it clones the repo, writes `.env`, optionally starts
a `pgvector/pgvector:pg16` container, and installs dependencies.

```bash
cd memory-soda
npm run dev
```

First boot applies migrations, creates your admin user, and prints an API key
once. Dashboard on :3000, API on :3004.

## Postgres

Choosing **docker** starts a container that already has pgvector and connects as
a superuser, so the extension migration just works. The container is named
`memory-soda-pg` and is reused (not recreated) if you run the installer again.

Choosing **existing** asks for a `DATABASE_URL` and checks that pgvector is
available on it. The role you connect as needs permission to
`CREATE EXTENSION vector` on first migration.

## Requirements

Node 20+, git, and either Docker or a Postgres 14+ with pgvector.

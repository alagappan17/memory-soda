# create-memory-soda

Scaffold a self-hosted [Memory Soda](https://github.com/alagappan17/memory-soda)
instance — API, dashboard, and a Postgres to point them at.

```bash
npm create memory-soda@latest
```

The installer checks each requirement before asking you to use it, creates
what it can, and ends with a checklist of anything it could not do for you.

1. **Preflight** — Node 20+ and git. Missing? Prints the install command for
   your OS and stops. Nothing is written.
2. **Folder** — `memory-soda` by default.
3. **Postgres** — bring your own URL, let it start `pgvector/pgvector:pg16` in
   Docker (offered when Docker is running), or skip.
4. **Database check** — connects, offers to create a missing database,
   confirms pgvector and enables the extension. Failures name the fix and let
   you retry, paste another URL, or skip.
5. **Gemini key** — checked live. Blank allowed; goes on the checklist.
6. **Ports and admin login** — ports checked for use; blank password is
   generated at first boot.
7. **Clone, `.env`, `npm ci`, migrations** — migrations run now if the database
   passed.

Then:

```bash
cd memory-soda
npm run dev
```

Sign in to the dashboard (:3000) to create an API key. `npm run update` pulls
and reinstalls later. Pass `--verbose` to stream clone/install output.

## Requirements

Node 20+, git. Postgres 14+ with pgvector, or Docker.

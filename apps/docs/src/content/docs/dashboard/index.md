---
title: "Dashboard"
description: "The bundled web UI, at http://localhost:3000."
---
The bundled web UI, at **http://localhost:3000**.

It is a debugging and administration tool, not an end-user product. Everything it
does goes through [`/dashboard/*` and `/auth/*`](/api/dashboard/).

---

## What it is for

| Question | Page |
|---|---|
| What does the system know about this user? | [Datasets](/dashboard/datasets/) |
| Why did it extract *that*? | [Playground](/dashboard/playground/) |
| How do I issue a key for my app? | [API keys](/dashboard/api-keys/) |
| How do I change retrieval behaviour? | [Project settings](/dashboard/project-settings/) |
| Who can sign in here? | [Users and sign-in](/dashboard/users-and-auth/) |
| Is anything broken? | Status |

---

## Layout

```
┌──────────────┬──────────────────────────────────────────┐
│ Memory Soda  │  Home                                    │
├──────────────┼──────────────────────────────────────────┤
│ Home         │                                          │
│              │                                          │
│ APPLICATION  │                                          │
│  Projects    │            page content                  │
│  Users       │                                          │
│  Status      │                                          │
│              │                                          │
│ PROJECT      │                                          │
│  Datasets    │                                          │
│  Playground  │                                          │
│  API Keys    │                                          │
│  Settings    │                                          │
├──────────────┤                                          │
│ (A) default ▾│                                          │
└──────────────┴──────────────────────────────────────────┘
```

The sidebar splits into two groups:

- **Application**, global. Projects, dashboard users, service health.
- **Project**, scoped to whichever project is selected in the switcher at the
  bottom.

The footer holds your **account avatar** (click for sign-out) and the **project
switcher**. Changing the project changes what every Project-group page shows.

---

## Signing in

The first admin user is created on first boot with a randomly generated password,
printed once to the API log. See [Users and sign-in](/dashboard/users-and-auth/).

Sessions last 7 days and are revocable server-side. Deep links survive sign-in,
visiting `/datasets?q=abc` while signed out returns you there afterwards.

---

## Stack

| | |
|---|---|
| Build | Vite 6 |
| Framework | React 19 + React Router 7 |
| Data | TanStack Query |
| UI | Tailwind + shadcn-style components on Base UI |
| Auth | session token in `localStorage`, attached by an axios interceptor |

It is a **single-page app**, not server-rendered. `VITE_API_URL` (default
`http://localhost:3004`) is baked in at build time and must match what the
browser can reach, not what the server can reach.

---

## Pages

### Home
A launcher grid over the same links as the sidebar, plus a greeting and the
current project. It shows no system state, no fact counts, no extraction
backlog, no failures.

### [Projects](/dashboard/projects/)
Create, rename and delete projects; jump to their settings.

### [Users and sign-in](/dashboard/users-and-auth/)
Dashboard login accounts. Unrelated to `dataset`, these are operators, not the
people being remembered.

### [Datasets](/dashboard/datasets/)
The most useful page. Per-dataset browser: threads and their messages, episodes,
extracted facts and resolved entities.

### [Playground](/dashboard/playground/)
An interactive console that exercises the real `/v1` API and shows every request
and response as it happens.

### [API keys](/dashboard/api-keys/)
Issue and revoke integration keys.

### [Project settings](/dashboard/project-settings/)
All fifteen episodic and semantic tuning values.

### Status
Calls `GET /health`. Green when Postgres answers `SELECT 1`.

> It does **not** check Gemini reachability, migration state, or whether the
> extraction pipeline is keeping up. A green Status page is compatible with every
> episode failing.

---

## What it cannot do

Worth knowing before you go looking:

| | Where to go instead |
|---|---|
| See failed episodes or extraction errors | Query `episodes` in SQL, `semanticStatus` is not surfaced anywhere |
| Delete an entire dataset | No UI and no endpoint. [Privacy and data deletion](/operations/privacy-and-deletion/) |
| Change your password | Create a new user and delete the old one |
| See which facts drove a past reply | Only the Playground, and only for the current session |
| View the knowledge graph as a graph | Not implemented, facts and entities are flat lists |
| Per-user project permissions | Any signed-in user can see every project |

---

## Security

The dashboard is an **administration surface**. Anyone who can sign in can read
every dataset in every project, issue API keys, and delete memory.

- Serve it on a trusted network, behind your own auth boundary if exposed.
- The session token lives in `localStorage` and is therefore readable by any XSS
  on that origin.
- There is no rate limiting on `/auth/login`.

See [Self-hosting](/operations/self-hosting/).

---

## Next

- [Datasets](/dashboard/datasets/), inspect what was learned
- [Playground](/dashboard/playground/), watch the pipeline run

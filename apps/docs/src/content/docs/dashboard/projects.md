---
title: "Projects"
description: "A project is the top-level tenant: it owns API keys, threads, episodes, facts, entities and settings."
---
A project is the top-level tenant: it owns API keys, threads, episodes, facts,
entities and settings.

See [Projects and datasets](/concepts/projects-and-datasets/) for the model.

---

## The project switcher

Bottom of the sidebar, next to your avatar.

Everything under the **Project** group, Datasets, Playground, API Keys, Settings
reads from whichever project is selected. The **Application** group (Projects,
Users, Status) ignores it.

The selection persists across page loads. If you are looking at an empty Datasets
page, check the switcher first.

---

## The Projects page

Lists every project with its name, description and creation date.

### Creating

| Field | Rule |
|---|---|
| Name | 1–100 characters, required |
| Description | Up to 500 characters, required by the form |

A new project starts empty: no keys, no data, and default settings.

To use it you need [an API key scoped to it](/dashboard/api-keys/).

### Renaming

Name and description are editable. The project **id** never changes, so existing
API keys keep working.

### Deleting

> **Irreversible, and it takes the memory with it.**
>
> Deleting a project cascades at the database level to its API keys, threads,
> messages, episodes, facts and entities. There is no soft delete, no export, and
> no undo.

Take a backup first if there is any doubt:

```bash
pg_dump "$DATABASE_URL" > backup-$(date +%F).sql
```

---

## When to use more than one

The default deployment has a single project called `default`, created
automatically the first time a key is made without choosing a project. That is
fine for most cases.

Add projects when you want **separate settings** or **separate blast radius**:

| Situation | Why |
|---|---|
| Staging vs production | Different data, different keys, no chance of cross-contamination |
| Two unrelated products on one deployment | Independent tuning, independent keys |
| A tenant that must never see another tenant | The only real isolation boundary, see below |

Do **not** use a project per end user. That is what
[datasets](/concepts/projects-and-datasets/) are for, and they need no
provisioning.

---

## Isolation

An API key resolves to exactly one project, and every query filters on it. A key
for project A cannot read project B.

Within a project there is **no isolation between datasets**, any key for the
project can read and delete every dataset in it. There are no per-dataset or
read-only keys.

So: if you are multi-tenant and a mistake must not leak one tenant's data to
another, give each tenant its own project and its own key. Otherwise a single
project with one dataset per user is simpler and correct.

> Dashboard access is **not** scoped by project. Any signed-in user sees all of
> them. Projects isolate *API keys*, not *operators*.

---

## Settings

Each project carries its own episodic and semantic settings, merged over the
built-in defaults, a project row only stores what you changed.

Reach them from the sidebar's **Project Settings** entry, or the card on Home.
See [Project settings](/dashboard/project-settings/).

---

## Scripting

```bash
API=http://localhost:3004
TOKEN=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"'"$ADMIN_PASSWORD"'"}' | jq -r .token)

# List
curl -s $API/dashboard/projects -H "Authorization: Bearer $TOKEN" | jq

# Create
PROJECT=$(curl -s -X POST $API/dashboard/projects \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"staging","description":"Pre-production"}' | jq -r .project.id)

# Issue a key for it
curl -s -X POST $API/dashboard/api-keys \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"name\":\"staging-app\",\"projectId\":\"$PROJECT\"}" | jq -r .key
```

Full reference: [Dashboard routes](/api/dashboard/).

---

## Next

- [API keys](/dashboard/api-keys/)
- [Project settings](/dashboard/project-settings/)
- [Projects and datasets](/concepts/projects-and-datasets/)

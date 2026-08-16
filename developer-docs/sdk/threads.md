# `client.threads`

Thread lifecycle. A thread is one conversation; memory belongs to the
[dataset](../concepts/projects-and-datasets.md), not the thread.

```ts
const thread = await memory.threads.create({ dataset: 'user_42' });
```

---

## `create()`

```ts
create(opts: WMCreateThreadRequest): Promise<WMCreateThreadResponse>
```

| Option | Type | Default | Notes |
|---|---|---|---|
| `dataset` | `string` | *generated* | Stable user identifier. **Always pass this.** |
| `tags` | `string[]` | `[]` | Free labels. |
| `metadata` | `Record<string, unknown>` | `null` | Arbitrary JSON. |
| `autoCompactThreshold` | `number` | `null` | Compact after this many un-compacted messages. Minimum 2. `null` disables. |
| `settings.episodic` | `Partial<ProjectEpisodicSettings>` | project defaults | Per-thread episodic overrides. |

```ts
const { threadId, dataset, createdAt, settings } = await memory.threads.create({
  dataset: 'user_42',
  tags: ['support', 'billing'],
  metadata: { channel: 'web', ticketId: 'T-1094' },
  autoCompactThreshold: 30,
  settings: {
    episodic: { autoEpisodeIntervalMs: 60_000 },
  },
});
```

> **Omitting `dataset` generates a random one.** Fine for demos; a bug in
> production, because you can never recall that memory again unless you store the
> generated value. See [Choosing a dataset key](../concepts/projects-and-datasets.md#choosing-a-dataset-key).

### Ephemeral threads

Turn off long-term memory for one conversation:

```ts
await memory.threads.create({
  dataset: 'user_42',
  settings: { episodic: { enabled: false } },
});
```

Messages are still stored and `prepare()` still works — nothing becomes a fact.

---

## `get()`

```ts
get(threadId: string): Promise<WMThread>
```

```ts
const thread = await memory.threads.get(threadId);
```

```json
{
  "threadId": "f2cb…",
  "dataset": "user_42",
  "tags": ["support"],
  "metadata": { "channel": "web" },
  "createdAt": "2026-08-16T09:02:11.000Z",
  "lastActivityAt": "2026-08-16T09:14:02.000Z",
  "settings": {
    "autoCompactThreshold": 30,
    "episodic": { "enabled": true, "autoEpisodeIntervalMs": 60000, "…": "…" }
  },
  "lastCompactedAt": null,
  "lastCompactedSequence": 0
}
```

Throws `ApiError` with `status: 404` when the thread does not exist **or belongs
to another project** — the two are deliberately indistinguishable.

> `WMThread` has no `messageCount`. Use
> [`getThreadStats()`](./working-memory.md#getthreadstats) for counts.

---

## `update()`

Merge-updates metadata. Existing keys are preserved; only the keys you send are
overwritten.

```ts
update(threadId: string, opts: WMPatchThreadRequest): Promise<WMThread>
```

```ts
// before: { channel: 'web', ticketId: 'T-1094' }
await memory.threads.update(threadId, { metadata: { resolved: true } });
// after:  { channel: 'web', ticketId: 'T-1094', resolved: true }
```

Merging is one level deep — a nested object is replaced wholesale, not merged.

```ts
// removing a key requires reading, deleting and writing the whole object
const { metadata } = await memory.threads.get(threadId);
delete metadata!.ticketId;
await memory.threads.update(threadId, { metadata: metadata! });
```

Only `metadata` is patchable. `tags`, `autoCompactThreshold` and `settings` are
fixed at creation.

---

## `end()`

```ts
end(threadId: string): Promise<WMEndThreadResponse>
```

```ts
const { threadId, episodeQueued } = await memory.threads.end(threadId);
// { threadId: 'f2cb…', episodeQueued: true }
```

> **This does not end the thread.** The thread stays writable and you can keep
> appending to it. `end()` queues [episode extraction](../concepts/episodic-memory.md)
> immediately instead of waiting out the inactivity timer.
>
> Read it as *checkpoint*, not *close*.

`episodeQueued` is `false` when episodic memory is disabled for the thread or
project.

### When to call it

- The user closed the chat window or the session expired
- A support ticket was resolved
- A test needs facts to exist now rather than in 30 seconds

Calling it repeatedly creates multiple episodes; each one archives the previous
and covers only the messages since the last. Harmless, but each costs three LLM
calls.

---

## Patterns

### Resume or create

```ts
async function getThread(userId: string, conversationId: string) {
  const stored = await db.conversations.findOne({ id: conversationId });
  if (stored?.threadId) return stored.threadId;

  const { threadId } = await memory.threads.create({
    dataset: userId,
    metadata: { conversationId },
  });
  await db.conversations.update(conversationId, { threadId });
  return threadId;
}
```

### One thread per session, memory across all of them

```ts
// Every session gets a fresh thread; all of them feed user_42's memory.
const { threadId } = await memory.threads.create({
  dataset: 'user_42',
  metadata: { sessionId, startedAt: new Date().toISOString() },
});
```

### Close-out on disconnect

```ts
socket.on('disconnect', () => {
  memory.threads.end(threadId).catch((err) =>
    logger.warn({ err, threadId }, 'failed to queue extraction'),
  );
});
```

---

## Not available

| | Status |
|---|---|
| Delete a thread | No endpoint. Deleting the row cascades to messages; do it in SQL. |
| List threads for a dataset | Dashboard only — [`GET /dashboard/threads`](../api/dashboard.md). |
| Change `tags` or `autoCompactThreshold` after creation | Not patchable. |

---

## Next

- [`client.workingMemory`](./working-memory.md) — appending and reading messages
- [Working memory](../concepts/working-memory.md) — the concepts

---
title: "Handling long conversations"
description: "Compaction keeps the message window bounded without losing what was said."
---
Compaction keeps the message window bounded without losing what was said.

---

## The problem

Send the whole history and cost grows linearly. Send a fixed tail and you lose
everything before it — including decisions and constraints that still apply.

Compaction folds older messages into a running summary:

```
before                              after
──────────────────────────────      ──────────────────────────────
msg 1   user      "budget $1000"    msg 1–39   compactedAt set,
msg 2   assistant "…"                          excluded from prepare()
…                                   msg 40     user  ← kept verbatim
msg 39  assistant "…"               msg 41     system "The user is choosing a
msg 40  user      "what about…"                camera under $1000, rejected
                                               mirrorless, interested in…"
```

---

## Enabling it

Per thread, at creation:

```ts
await memory.createThread({
  dataset: 'user_42',
  autoCompactThreshold: 40,   // compact once 40 un-compacted messages accumulate
});
```

Minimum 2. Omit it and compaction never runs automatically.

Auto-compaction fires from `addMessage` when the un-compacted count crosses the
threshold.

---

## The one rule

> **`messageLimit` must be ≥ `autoCompactThreshold`.**

If it is not, messages between the summary and the retrieved tail vanish:

```
threshold 40, messageLimit 10

[summary covering 1–39]  [40] [41] [42] … [55]
                          └──── only the last 10 returned ────┘
                                messages 40–45 lost
```

The summary covers 1–39. The tail covers 46–55. Nothing covers 40–45 — the model
never sees them.

`prepare()` detects this and returns a `warning`:

```ts
const { messages, warning } = await memory.prepare(threadId, {
  messageLimit: 10,
});

if (warning) {
  logger.warn({ threadId, warning }, 'context may be incomplete');
}
// "messageLimit (10) is less than autoCompactThreshold (40). Messages between
//  the compact summary and the retrieved tail may be missing…"
```

Keep them equal and you cannot get it wrong:

```ts
const WINDOW = 40;

await memory.createThread({ dataset: userId, autoCompactThreshold: WINDOW });
await memory.prepare(threadId, { messageLimit: WINDOW });
```

> `messageLimit` maxes out at **100**, so `autoCompactThreshold` above 100 is
> always unsafe.

---

## How it behaves

**Rolling.** Each run folds the previous summary into the new one. There is
always exactly one active summary, never a stack.

**Non-destructive.** Original rows are kept and stamped `compactedAt`.
`listMessages()` still returns them and the dashboard still shows them;
`prepare()` does not.

**Keeps the trigger message.** The message that crossed the threshold stays
verbatim (`keepLast: 1`), so the next turn sees the user's actual words rather
than a paraphrase.

**Summary is never truncated.** The active summary is always first in
`prepare()` and never counts against `messageLimit` — lowering the limit cannot
drop compacted context.

**Does not affect extraction.** Episodes record the sequence range they cover and
read raw message rows. Compaction and fact extraction are independent.

---

## The latency spike

Auto-compaction runs **inline** in `addMessage`. That call makes an LLM request
and can take up to 30 seconds.

```ts
const res = await memory.addMessage(threadId, { role: 'user', content: msg });
if (res.compacted) {
  // this call just paid for a summarisation
}
```

Most calls are 5–15 ms. Every ~40th is seconds.

### Keeping it off the request path

Leave `autoCompactThreshold` unset and compact yourself:

```ts
// after responding, off the critical path
void (async () => {
  const { messageCount } = await memory.prepare(threadId, { messageLimit: 1 });
  if (messageCount >= 40) {
    await memory.compact(threadId);
  }
})().catch((err) => logger.warn({ err }, 'background compaction failed'));
```

Or run it on a schedule for idle threads.

### Handling the two response shapes

`compact()` returns different objects depending on whether there was work:

```ts
const result = await memory.compact(threadId);

if ('summaryMessageId' in result) {
  logger.info({ count: result.compactedCount, to: result.toSequence }, 'compacted');
} else {
  // { ok: true, compacted: false, message: 'Nothing to compact' }
}
```

---

## Choosing a threshold

| Threshold | Suits |
|---|---|
| `10–20` | Short support chats. Compacts often; summary stays tight |
| `30–50` | General assistants. A good default |
| `60–100` | Long analytical sessions where detail matters |
| unset | Short conversations, or you manage context yourself |

Higher thresholds mean fewer LLM calls but a bigger window sent to your model
every turn. The token you save on compaction you spend on every request in
between.

---

## What a summary loses

Summarisation is lossy by design. The prompt instructs the model never to drop a
decision, fact, constraint or unresolved question that is still relevant — but
exact wording, tone and incidental detail go.

If exact phrasing matters — quoting a user back to themselves, legal or medical
context — either:

- raise the threshold so more stays verbatim, or
- read the originals with `listMessages()`, which still has everything.

Long-term facts are **not** at risk: extraction runs on raw messages, not on
summaries.

---

## Inspecting

```ts
// what the model will see
const { messages, messageCount, truncated, compacted } =
  await memory.prepare(threadId, { messageLimit: 40 });

// everything, including compacted rows
const all = await memory.listMessages(threadId, { limit: 100 });
const summaries = all.messages.filter((m) => m.role === 'system' && m.compactedAt === null);
```

Summary rows carry:

```json
{
  "type": "compact_summary",
  "compactedRange": { "fromSeq": 1, "toSeq": 39, "count": 39 }
}
```

The [Datasets](/dashboard/datasets/) page shows compacted messages too, which
is the easiest way to see what a summary replaced.

---

## Checklist

- [ ] `messageLimit >= autoCompactThreshold`
- [ ] `autoCompactThreshold <= 100`
- [ ] `warning` from `prepare()` logged
- [ ] Decided whether the inline latency spike is acceptable
- [ ] `compact()`'s two response shapes handled

---

## Next

- [Working memory](/concepts/working-memory/) — the mechanics
- [Build a chatbot with memory](/guides/build-a-chatbot/)

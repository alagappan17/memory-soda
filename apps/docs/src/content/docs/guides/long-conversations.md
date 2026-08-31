---
title: 'Handling long conversations'
description: 'Compaction keeps the message window bounded without losing what was said.'
---

Precondition: threads long enough that sending full history is too expensive.
Outcome: a bounded window with a rolling summary, and no silent context loss.

How compaction works mechanically:
[Working memory](/concepts/working-memory/#compaction).

## Enabling it

Per thread, at creation:

```ts
await memory.createThread({
  dataset: 'user_42',
  autoCompactThreshold: 40, // compact once 40 un-compacted messages accumulate
});
```

Minimum 2. Omit it and compaction never runs automatically.

## The one rule

> **`messageLimit` must be ≥ `autoCompactThreshold`.**

If it is not, messages between the summary and the retrieved tail vanish:

```
threshold 40, messageLimit 10

[summary covering 1–39]  [40] [41] [42] … [55]
                          └──── only the last 10 returned ────┘
                                messages 40–45 lost
```

`prepare()` detects this and returns a `warning`, log it. Keep the two equal
and you cannot get it wrong:

```ts
const WINDOW = 40;
await memory.createThread({ dataset: userId, autoCompactThreshold: WINDOW });
await memory.prepare(threadId, { messageLimit: WINDOW });
```

> `messageLimit` maxes out at **100**, so `autoCompactThreshold` above 100 is
> always unsafe.

## The latency spike

Auto-compaction runs **inline** in `addMessage`. That call makes an LLM request
and can take up to 30 seconds. Most calls are 5–15 ms; every ~40th is seconds.

To keep it off the request path, leave `autoCompactThreshold` unset and compact
yourself:

```ts
// after responding, off the critical path
void (async () => {
  const { messageCount } = await memory.prepare(threadId, { messageLimit: 1 });
  if (messageCount >= 40) await memory.compact(threadId);
})().catch((err) => logger.warn({ err }, 'background compaction failed'));
```

`compact()` returns different objects depending on whether there was work:

```ts
const result = await memory.compact(threadId);
if ('summaryMessageId' in result) {
  // { threadId, summaryMessageId, compactedCount, fromSequence, toSequence }
} else {
  // { ok: true, compacted: false, message: 'Nothing to compact' }
}
```

## Choosing a threshold

| Threshold | Suits                                                    |
| --------- | -------------------------------------------------------- |
| `10–20`   | Short support chats. Compacts often; summary stays tight |
| `30–50`   | General assistants. A good default                       |
| `60–100`  | Long analytical sessions where detail matters            |
| unset     | Short conversations, or you manage context yourself      |

Higher thresholds mean fewer LLM calls but a bigger window sent to your model
every turn. The token you save on compaction you spend on every request in
between.

## What a summary loses

Summarisation is lossy by design. The prompt instructs the model never to drop
a decision, fact, constraint or unresolved question, but exact wording, tone
and incidental detail go.

If exact phrasing matters, quoting a user back to themselves, legal or medical
context, either raise the threshold so more stays verbatim, or read the
originals with `listMessages()`, which still has everything.

Long-term facts are **not** at risk: extraction runs on raw messages, not on
summaries.

## Inspecting

```ts
// what the model will see
const { messages } = await memory.prepare(threadId, { messageLimit: 40 });

// everything, including compacted rows
const all = await memory.listMessages(threadId, { limit: 100 });
```

Summary rows carry
`metadata: { "type": "compact_summary", "compactedRange": { "fromSeq": 1, "toSeq": 39, "count": 39 } }`.
The [Datasets](/dashboard/datasets/) page shows compacted messages too, the
easiest way to see what a summary replaced.

## Checklist

- [ ] `messageLimit >= autoCompactThreshold`
- [ ] `autoCompactThreshold <= 100`
- [ ] `warning` from `prepare()` logged
- [ ] Decided whether the inline latency spike is acceptable
- [ ] `compact()`'s two response shapes handled

## Next

- [Working memory](/concepts/working-memory/), the mechanics
- [Build a chatbot with memory](/guides/build-a-chatbot/)

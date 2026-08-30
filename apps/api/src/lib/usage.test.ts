import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  costOf,
  drain,
  extendUsage,
  log,
  runWithUsage,
  timed,
} from './usage.js';

test('costOf prices tokens, estimates from chars, null when unpriced', () => {
  const base = { inputTokens: 0, outputTokens: 0, inputChars: 0 };
  assert.equal(
    costOf({
      ...base,
      service: 'gemini',
      model: 'gemini-2.5-flash',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    }),
    2.8,
  );
  assert.equal(
    costOf({
      ...base,
      service: 'gemini',
      model: 'models/gemini-embedding-001',
      inputChars: 4_000_000,
    }),
    0.15,
  );
  assert.equal(costOf({ ...base, service: 'openai', model: 'gpt-x' }), null);
  assert.equal(costOf({ ...base, service: null, model: null }), null);
});

test('log merges the async context and drops rows without a project', async () => {
  drain();
  log({ stage: 'orphan', kind: 'span', latencyMs: 1 });
  assert.equal(drain().length, 0);

  await runWithUsage(
    { source: 'worker', operation: 'job', projectId: 'p1' },
    async () => {
      extendUsage({ threadId: 't1' });
      await timed({ stage: 'ok', kind: 'span' }, async () => 1);
      await timed(
        { stage: 'bad', kind: 'llm', service: 'gemini' },
        async () => {
          throw new Error('boom');
        },
      ).catch(() => undefined);
    },
  );
  const rows = drain();
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.threadId, 't1');
  assert.equal(rows[0]!.source, 'worker');
  assert.equal(rows[0]!.requestId, rows[1]!.requestId);
  assert.equal(rows[1]!.ok, false);
  assert.equal(rows[1]!.error, 'boom');
});

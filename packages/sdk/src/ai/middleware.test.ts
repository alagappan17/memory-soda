import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { memoryMiddleware } from './middleware.ts';
import type { MemorySoda } from '../client.ts';

interface Fake {
  memory: MemorySoda;
  recalls: unknown[];
  writes: { thread: string; messages: unknown[] }[];
}
function fakeMemory(opts: {
  context?: string;
  episodes?: { summary: string }[];
  recallDelayMs?: number;
  fail?: boolean;
} = {}): Fake {
  const recalls: unknown[] = [];
  const writes: Fake['writes'] = [];
  const memory = {
    async recall(req: unknown) {
      recalls.push(req);
      if (opts.fail) throw new Error('down');
      if (opts.recallDelayMs) await new Promise((r) => setTimeout(r, opts.recallDelayMs));
      return {
        context: opts.context ?? '',
        episodes: opts.episodes ? { episodes: opts.episodes } : null,
      };
    },
    async addMessages(thread: string, messages: unknown[]) {
      writes.push({ thread, messages });
      return [];
    },
  } as unknown as MemorySoda;
  return { memory, recalls, writes };
}

const prompt = [
  { role: 'user', content: 'earlier' },
  { role: 'assistant', content: 'reply' },
  { role: 'user', content: [{ type: 'text', text: 'what do I like?' }] },
];

const flush = () => new Promise((r) => setImmediate(r));

describe('memoryMiddleware.transformParams', () => {
  test('appends recalled context to the system prompt, querying with the last user text', async () => {
    const f = fakeMemory({ context: '- likes tea' });
    const mw = memoryMiddleware({ memory: f.memory, dataset: 'u', limit: 2 });
    const out = await mw.transformParams({ params: { system: 'Be nice.', prompt } });
    assert.deepEqual(f.recalls, [{ dataset: 'u', query: 'what do I like?', limit: 2 }]);
    assert.match(String(out['system']), /^Be nice\.\n\nWhat you remember about this user/);
    assert.match(String(out['system']), /- likes tea$/);
  });

  test('includes episode summaries when asked', async () => {
    const f = fakeMemory({ context: 'ctx', episodes: [{ summary: 'talked about tea' }] });
    const mw = memoryMiddleware({ memory: f.memory, dataset: 'u', includeEpisodes: true });
    const out = await mw.transformParams({ params: { prompt } });
    assert.deepEqual((f.recalls[0] as { include: string[] }).include, ['episodes']);
    assert.match(String(out['system']), /Earlier conversations:\n- talked about tea/);
  });

  test('leaves params untouched when nothing is remembered, recall is off, or recall fails', async () => {
    const params = { prompt };
    const empty = memoryMiddleware({ memory: fakeMemory().memory, dataset: 'u' });
    assert.equal(await empty.transformParams({ params }), params);

    const off = fakeMemory({ context: 'x' });
    const offMw = memoryMiddleware({ memory: off.memory, dataset: 'u', recall: false });
    assert.equal(await offMw.transformParams({ params }), params);
    assert.equal(off.recalls.length, 0);

    const errors: string[] = [];
    const failing = memoryMiddleware({
      memory: fakeMemory({ fail: true }).memory,
      dataset: 'u',
      onError: (stage) => errors.push(stage),
    });
    assert.equal(await failing.transformParams({ params }), params);
    assert.deepEqual(errors, ['recall']);
  });

  test('a slow recall is abandoned after recallTimeoutMs', async () => {
    const errors: string[] = [];
    const mw = memoryMiddleware({
      memory: fakeMemory({ context: 'x', recallDelayMs: 50 }).memory,
      dataset: 'u',
      recallTimeoutMs: 5,
      onError: (stage, err) => errors.push(`${stage}:${(err as Error).message}`),
    });
    const params = { prompt };
    assert.equal(await mw.transformParams({ params }), params);
    assert.deepEqual(errors, ['recall:Timed out after 5ms']);
  });
});

describe('memoryMiddleware write-back', () => {
  test('wrapGenerate writes the last prompt message and the reply to the thread', async () => {
    const f = fakeMemory();
    const mw = memoryMiddleware({ memory: f.memory, dataset: 'u', threadId: 't1' });
    const result = await mw.wrapGenerate({
      doGenerate: async () => ({ text: 'tea, obviously' }),
      params: { prompt },
    });
    assert.deepEqual(result, { text: 'tea, obviously' });
    await flush();
    assert.deepEqual(f.writes, [
      {
        thread: 't1',
        messages: [
          { role: 'user', content: 'what do I like?' },
          { role: 'assistant', content: 'tea, obviously' },
        ],
      },
    ]);
  });

  test('wrapStream writes only the user side and resolves the thread lazily', async () => {
    const f = fakeMemory();
    const mw = memoryMiddleware({ memory: f.memory, dataset: 'u', threadId: async () => 'lazy' });
    await mw.wrapStream({ doStream: async () => 'stream', params: { prompt } });
    await flush();
    assert.deepEqual(f.writes, [{ thread: 'lazy', messages: [{ role: 'user', content: 'what do I like?' }] }]);
  });

  test('no thread means no writes; write:false disables them', async () => {
    const f = fakeMemory();
    await memoryMiddleware({ memory: f.memory, dataset: 'u' }).wrapGenerate({
      doGenerate: async () => ({ text: 'x' }),
      params: { prompt },
    });
    await memoryMiddleware({ memory: f.memory, dataset: 'u', threadId: 't', write: false }).wrapGenerate({
      doGenerate: async () => ({ text: 'x' }),
      params: { prompt },
    });
    await flush();
    assert.equal(f.writes.length, 0);
  });

  test('a write failure is reported, not thrown', async () => {
    const errors: string[] = [];
    const memory = {
      async addMessages() { throw new Error('down'); },
    } as unknown as MemorySoda;
    const mw = memoryMiddleware({ memory, dataset: 'u', threadId: 't', recall: false, onError: (s) => errors.push(s) });
    await mw.wrapGenerate({ doGenerate: async () => ({ text: 'x' }), params: { prompt } });
    await flush();
    assert.deepEqual(errors, ['write']);
  });
});

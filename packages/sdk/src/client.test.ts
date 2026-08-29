import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MemorySoda } from './client.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env['MEMORY_SODA_BASE_URL'];
  delete process.env['MEMORY_SODA_API_KEY'];
});

type Seen = { method: string; url: string; body: unknown };
/** Answer every request with `reply(seen)`; records what the client sent. */
function fake(reply: (s: Seen) => unknown = () => ({})) {
  const seen: Seen[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const s = {
      method: init.method ?? 'GET',
      url: url.replace('http://api.test', ''),
      body: init.body ? JSON.parse(init.body as string) : undefined,
    };
    seen.push(s);
    return new Response(JSON.stringify(reply(s)), { status: 200 });
  }) as typeof fetch;
  return seen;
}

const client = () =>
  new MemorySoda({ baseUrl: 'http://api.test', apiKey: 'k', maxRetries: 0 });

describe('MemorySoda config', () => {
  test('reads the environment when not configured', () => {
    process.env['MEMORY_SODA_BASE_URL'] = 'http://env.test';
    process.env['MEMORY_SODA_API_KEY'] = 'envkey';
    assert.doesNotThrow(() => new MemorySoda());
  });
  test('throws a clear error when a value is missing', () => {
    assert.throws(() => new MemorySoda({ apiKey: 'k' }), /No baseUrl/);
    assert.throws(() => new MemorySoda({ baseUrl: 'http://x' }), /No apiKey/);
  });
});

describe('MemorySoda routes', () => {
  test('threads', async () => {
    const seen = fake();
    const c = client();
    await c.createThread({ dataset: 'u1' });
    await c.getThread('t1');
    await c.updateThread('t1', { metadata: { a: 1 } });
    await c.endThread('t1');
    assert.deepEqual(
      seen.map((s) => [s.method, s.url]),
      [
        ['POST', '/v1/threads'],
        ['GET', '/v1/threads/t1'],
        ['PATCH', '/v1/threads/t1'],
        ['POST', '/v1/threads/t1/end'],
      ],
    );
    assert.deepEqual(seen[0]!.body, { dataset: 'u1' });
  });

  test('messages are appended sequentially in order', async () => {
    let n = 0;
    const seen = fake(() => ({ sequenceNumber: ++n }));
    const out = await client().addMessages('t1', [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ]);
    assert.deepEqual(out.map((m) => m.sequenceNumber), [1, 2]);
    assert.ok(seen.every((s) => s.url === '/v1/memory/working/threads/t1/messages'));
    assert.deepEqual(seen.map((s) => s.body.content), ['a', 'b']);
  });

  test('listMessages and prepare', async () => {
    const seen = fake();
    await client().listMessages('t1', { limit: 5, order: 'desc' });
    await client().prepare('t1', { messageLimit: 3 });
    assert.equal(seen[0]!.url, '/v1/memory/working/threads/t1/messages?limit=5&order=desc');
    assert.equal(seen[1]!.url, '/v1/memory/working/threads/t1/prepare');
    assert.deepEqual(seen[1]!.body, { messageLimit: 3 });
  });

  test('recall posts the request as-is', async () => {
    const seen = fake();
    await client().recall({ dataset: 'u1', query: 'q', include: ['raw'] });
    assert.equal(seen[0]!.url, '/v1/memory/recall');
    assert.deepEqual(seen[0]!.body, { dataset: 'u1', query: 'q', include: ['raw'] });
  });

  test('prepareAndRecall runs both in parallel with a dataset, else after prepare', async () => {
    const seen = fake((s) => (s.url.endsWith('/prepare') ? { dataset: 'from-thread' } : {}));
    const c = client();
    await c.prepareAndRecall('t1', { dataset: 'u1', messageLimit: 4, query: 'q' });
    assert.deepEqual(seen[0]!.body, { messageLimit: 4 });
    assert.deepEqual(seen[1]!.body, { dataset: 'u1', query: 'q' });

    seen.length = 0;
    await c.prepareAndRecall('t1', { query: 'q' });
    assert.ok(seen[0]!.url.endsWith('/prepare'));
    assert.deepEqual(seen[1]!.body, { dataset: 'from-thread', query: 'q' });
  });

  test('listFacts encodes the dataset, serializes Date asOf, drops undefined', async () => {
    const seen = fake(() => ({ facts: [], total: 0 }));
    await client().listFacts('a/b', {
      q: 'x',
      asOf: new Date('2024-01-01T00:00:00Z'),
      includeInvalidated: true,
    });
    assert.equal(
      seen[0]!.url,
      '/v1/memory/semantic/datasets/a%2Fb/facts?q=x&includeInvalidated=true&asOf=2024-01-01T00%3A00%3A00.000Z',
    );
  });

  test('listFacts with entity uses the entity route, lowercases, derives total', async () => {
    const seen = fake(() => ({ facts: [{ factId: '1' }, { factId: '2' }] }));
    const out = await client().listFacts('u1', { entity: 'Paris' });
    assert.equal(seen[0]!.url, '/v1/memory/semantic/datasets/u1/entities/paris/facts');
    assert.equal(out.total, 2);
  });

  test('facts, entities, episodes, datasets', async () => {
    const seen = fake(() => ({ entities: [], episodes: [], episode: {} }));
    const c = client();
    await c.deleteFact('u1', 'f1');
    await c.listEntities('u1');
    await c.listEpisodes('u1', { limit: 2, status: 'all' });
    await c.searchEpisodes('u1', 'q', { limit: 3 });
    await c.getEpisode('e1');
    await c.exportDataset('u1');
    await c.forgetDataset('u1');
    await c.health();
    assert.deepEqual(
      seen.map((s) => [s.method, s.url]),
      [
        ['DELETE', '/v1/memory/semantic/datasets/u1/facts/f1'],
        ['GET', '/v1/memory/semantic/datasets/u1/entities'],
        ['GET', '/v1/memory/episodic/datasets/u1/episodes?limit=2&status=all'],
        ['GET', '/v1/memory/episodic/datasets/u1/episodes/search?q=q&limit=3'],
        ['GET', '/v1/memory/episodic/episodes/e1'],
        ['GET', '/v1/memory/recall/datasets/u1/export'],
        ['DELETE', '/v1/memory/recall/datasets/u1'],
        ['GET', '/health'],
      ],
    );
  });
});

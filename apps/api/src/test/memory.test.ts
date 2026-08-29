import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApi, type Api } from './harness.ts';

let api: Api;
let key: string;
let projectId: string;
before(async () => {
  api = await startApi('memory');
  ({ key, projectId } = await api.project());
});
after(() => api.stop());

const call = (method: string, path: string, body?: unknown, token = key) =>
  api.call(method, path, { body, token });

async function newThread(body: Record<string, unknown> = {}) {
  const res = await call('POST', '/v1/threads', body);
  assert.equal(res.status, 201);
  return res.body as { threadId: string; dataset: string };
}

test('threads: create with generated dataset, get, patch merges metadata', async () => {
  const t = await newThread({ metadata: { a: 1 }, tags: ['x'] });
  assert.ok(t.dataset.length > 0, 'dataset generated');

  const got = await call('GET', `/v1/threads/${t.threadId}`);
  assert.equal(got.status, 200);
  assert.deepEqual(got.body.tags, ['x']);
  assert.equal(got.body.settings.episodic.enabled, true);

  const patched = await call('PATCH', `/v1/threads/${t.threadId}`, {
    metadata: { b: 2 },
  });
  assert.deepEqual(patched.body.metadata, { a: 1, b: 2 });

  const missing = await call('GET', '/v1/threads/00000000-0000-0000-0000-000000000000');
  assert.equal(missing.status, 404);
  assert.equal((await call('GET', '/v1/threads/not-a-uuid')).status, 400);
});

test('threads are invisible to another project', async () => {
  const t = await newThread();
  const other = await api.project();
  const res = await call('GET', `/v1/threads/${t.threadId}`, undefined, other.key);
  assert.equal(res.status, 404);
});

test('thread episodic override is applied over project defaults', async () => {
  const t = await newThread({ settings: { episodic: { enabled: false } } });
  const got = await call('GET', `/v1/threads/${t.threadId}`);
  assert.equal(got.body.settings.episodic.enabled, false);
  assert.equal(got.body.settings.episodic.maxMessages, 100);

  const end = await call('POST', `/v1/threads/${t.threadId}/end`);
  assert.equal(end.status, 200);
  assert.deepEqual(end.body, { threadId: t.threadId, episodeQueued: false });
});

test('ending a thread with nothing new does not queue an episode', async () => {
  const t = await newThread();
  const end = await call('POST', `/v1/threads/${t.threadId}/end`);
  assert.equal(end.body.episodeQueued, false);
});

test('working memory: add, list, prepare, stats', async () => {
  const t = await newThread();
  const base = `/v1/memory/working/threads/${t.threadId}`;

  const m1 = await call('POST', `${base}/messages`, { role: 'user', content: 'hi' });
  assert.equal(m1.status, 201);
  assert.equal(m1.body.sequenceNumber, 1);
  assert.equal(m1.body.compacted, false);
  const m2 = await call('POST', `${base}/messages`, {
    role: 'assistant',
    content: 'hello',
    tokens: { input: 1, output: 2 },
    model: 'x',
  });
  assert.equal(m2.body.sequenceNumber, 2);

  const bad = await call('POST', `${base}/messages`, { role: 'robot', content: 'x' });
  assert.equal(bad.status, 400);

  const asc = await call('GET', `${base}/messages`);
  assert.equal(asc.status, 200);
  assert.deepEqual(asc.body.messages.map((m: any) => m.content), ['hi', 'hello']);

  const desc = await call('GET', `${base}/messages?order=desc&limit=1`);
  assert.deepEqual(desc.body.messages.map((m: any) => m.content), ['hello']);

  const prepared = await call('POST', `${base}/prepare`, { messageLimit: 10 });
  assert.equal(prepared.status, 200);
  assert.equal(prepared.body.dataset, t.dataset);
  assert.equal(prepared.body.compacted, false);
  assert.deepEqual(prepared.body.messages.map((m: any) => m.role), ['user', 'assistant']);

  const stats = await call('GET', `${base}/stats`);
  assert.equal(stats.status, 200);
  assert.equal(stats.body.messageCount, 2);

  const empty = await newThread();
  const nothing = await call('POST', `/v1/memory/working/threads/${empty.threadId}/compact`);
  assert.equal(nothing.status, 200);
  assert.equal(nothing.body.compacted, false);
});

test('working memory on an unknown thread is 404', async () => {
  const base = '/v1/memory/working/threads/00000000-0000-0000-0000-000000000000';
  assert.equal((await call('POST', `${base}/messages`, { role: 'user', content: 'x' })).status, 404);
  assert.equal((await call('GET', `${base}/messages`)).status, 404);
  assert.equal((await call('POST', `${base}/prepare`, {})).status, 404);
  assert.equal((await call('GET', `${base}/stats`)).status, 404);
});

test('adding a message schedules an auto episode', async () => {
  const t = await newThread();
  await call(`POST`, `/v1/memory/working/threads/${t.threadId}/messages`, {
    role: 'user',
    content: 'x',
  });
  const rows = await api.db.select().from(api.schema.scheduledEpisodes);
  assert.ok(rows.some((r) => r.threadId === t.threadId));
});

/** Seed facts directly: extraction is an LLM job, not under test here. */
async function seedFacts(dataset: string) {
  const { facts, entities } = api.schema;
  await api.db.insert(entities).values([
    { dataset, projectId, name: 'user', type: 'person' },
    { dataset, projectId, name: 'paris', type: 'location' },
  ]);
  const [live, old, weak] = await api.db
    .insert(facts)
    .values([
      { dataset, projectId, subject: 'user', predicate: 'lives in', object: 'paris', objectIsEntity: true, confidence: 0.9 },
      { dataset, projectId, subject: 'user', predicate: 'lives in', object: 'lyon', confidence: 0.9, invalidAt: new Date('2024-01-01'), validAt: new Date('2023-01-01') },
      { dataset, projectId, subject: 'user', predicate: 'likes', object: 'jazz', confidence: 0.2 },
    ])
    .returning({ id: facts.id });
  return { live: live!.id, old: old!.id, weak: weak!.id };
}

test('semantic: list, keyword filter, includeInvalidated, asOf, entities, soft delete', async () => {
  const dataset = 'sem_user';
  const ids = await seedFacts(dataset);
  const base = `/v1/memory/semantic/datasets/${dataset}`;

  const live = await call('GET', `${base}/facts`);
  assert.equal(live.status, 200);
  assert.equal(live.body.total, 2);
  assert.ok(live.body.facts.every((f: any) => f.factId !== ids.old));

  const all = await call('GET', `${base}/facts?includeInvalidated=true`);
  assert.equal(all.body.total, 3);

  const q = await call('GET', `${base}/facts?q=jazz`);
  assert.equal(q.body.total, 1);
  assert.equal(q.body.facts[0].object, 'jazz');

  const asOf = await call('GET', `${base}/facts?asOf=2023-06-01T00:00:00Z`);
  assert.equal(asOf.body.total, 0, 'seeded rows were created now, so none existed then');

  const ents = await call('GET', `${base}/entities`);
  assert.deepEqual(ents.body.entities.map((e: any) => e.name).sort(), ['paris', 'user']);

  const entFacts = await call('GET', `${base}/entities/PARIS/facts`);
  assert.equal(entFacts.body.facts.length, 1);
  assert.equal(entFacts.body.facts[0].factId, ids.live);

  const del = await call('DELETE', `${base}/facts/${ids.live}`);
  assert.deepEqual(del.body, { factId: ids.live, deleted: true });
  assert.equal((await call('DELETE', `${base}/facts/${ids.live}`)).status, 404);
  assert.equal((await call('GET', `${base}/facts`)).body.total, 1);
});

test('recall renders live facts above the confidence floor, no LLM needed', async () => {
  const dataset = 'recall_user';
  await seedFacts(dataset);

  const res = await call('POST', '/v1/memory/recall', { dataset, include: ['raw'] });
  assert.equal(res.status, 200);
  assert.equal(res.body.factCount, 1, 'invalidated and low-confidence facts excluded');
  assert.match(res.body.context, /paris/i);
  assert.equal(res.body.facts.length, 1);
  assert.equal(res.body.episodes, null);
  assert.equal(res.body.synthesis, null);

  const lowFloor = await call('POST', '/v1/memory/recall', { dataset, minConfidence: 0 });
  assert.equal(lowFloor.body.factCount, 2);
  assert.match(lowFloor.body.context, /jazz/);

  // A query still works: embedding fails without a real key, retrieval falls back.
  const withQuery = await call('POST', '/v1/memory/recall', { dataset, query: 'where do they live' });
  assert.equal(withQuery.status, 200);
  assert.equal(withQuery.body.factCount, 1);

  assert.equal((await call('POST', '/v1/memory/recall', { dataset: 'nobody' })).body.context, '');
  assert.equal((await call('POST', '/v1/memory/recall', {})).status, 400);
});

test('dataset export and forget', async () => {
  const dataset = 'gdpr_user';
  await seedFacts(dataset);
  const t = await newThread({ dataset });
  await call('POST', `/v1/memory/working/threads/${t.threadId}/messages`, { role: 'user', content: 'secret' });

  const exp = await call('GET', `/v1/memory/recall/datasets/${dataset}/export`);
  assert.equal(exp.status, 200);
  assert.equal(exp.body.dataset, dataset);
  assert.equal(exp.body.threads.length, 1);
  assert.equal(exp.body.threads[0].messages[0].content, 'secret');
  assert.equal(exp.body.facts.length, 3);
  assert.equal(exp.body.entities.length, 2);

  const del = await call('DELETE', `/v1/memory/recall/datasets/${dataset}`);
  assert.equal(del.status, 200);
  assert.equal(del.body.deleted.threads, 1);
  assert.equal(del.body.deleted.facts, 3);

  assert.equal((await call('GET', `/v1/threads/${t.threadId}`)).status, 404);
  const again = await call('GET', `/v1/memory/recall/datasets/${dataset}/export`);
  assert.equal(again.body.threads.length, 0);
  assert.equal(again.body.facts.length, 0);
});

test('episodes: list, get 404, archive twice is 400', async () => {
  const dataset = 'ep_user';
  const [ep] = await api.db
    .insert(api.schema.episodes)
    .values({ dataset, projectId, status: 'completed', summary: 'talked about paris' })
    .returning({ id: api.schema.episodes.id });
  const base = `/v1/memory/episodic`;

  const list = await call('GET', `${base}/datasets/${dataset}/episodes`);
  assert.equal(list.status, 200);
  assert.equal(list.body.episodes.length, 1);

  const one = await call('GET', `${base}/episodes/${ep!.id}`);
  assert.equal(one.body.episode.summary, 'talked about paris');
  assert.equal((await call('GET', `${base}/episodes/00000000-0000-0000-0000-000000000000`)).status, 404);

  assert.equal((await call('DELETE', `${base}/episodes/${ep!.id}`)).status, 200);
  assert.equal((await call('DELETE', `${base}/episodes/${ep!.id}`)).status, 400);
  const retry = await call('POST', `${base}/episodes/${ep!.id}/retry`);
  assert.equal(retry.status, 400);
});

test('a new thread in the same dataset pulls sibling idle timers forward', async () => {
  const a = await newThread();
  await call('POST', `/v1/memory/working/threads/${a.threadId}/messages`, {
    role: 'user',
    content: 'x',
  });
  const { NEW_THREAD_GRACE_MS } = await import('../services/thread.service.js');
  const { eq } = await import('drizzle-orm');
  const { scheduledEpisodes } = api.schema;
  const before = await api.db.select().from(scheduledEpisodes).where(eq(scheduledEpisodes.threadId, a.threadId));
  assert.ok(before[0]!.fireAt.getTime() > Date.now() + NEW_THREAD_GRACE_MS, 'idle timer starts far out');

  // Different dataset: untouched.
  await newThread();
  const untouched = await api.db.select().from(scheduledEpisodes).where(eq(scheduledEpisodes.threadId, a.threadId));
  assert.equal(untouched[0]!.fireAt.getTime(), before[0]!.fireAt.getTime());

  await newThread({ dataset: a.dataset });
  const after = await api.db.select().from(scheduledEpisodes).where(eq(scheduledEpisodes.threadId, a.threadId));
  assert.ok(after[0]!.fireAt.getTime() <= Date.now() + NEW_THREAD_GRACE_MS, 'pulled forward to grace');
});

test('sleep-time sweep finds abandoned threads with uncaptured messages', async () => {
  const t = await newThread();
  await call('POST', `/v1/memory/working/threads/${t.threadId}/messages`, {
    role: 'user',
    content: 'x',
  });
  const { findAbandonedThreads, ABANDONED_AFTER_MS } = await import('../services/episodic-memory.service.js');
  const { eq } = await import('drizzle-orm');
  const { scheduledEpisodes, threads, episodes } = api.schema;
  const found = async () => (await findAbandonedThreads()).some((r) => r.id === t.threadId);

  // An idle timer is waiting on it: not the sweep's job.
  await api.db
    .update(threads)
    .set({ lastActivityAt: new Date(Date.now() - ABANDONED_AFTER_MS - 1000) })
    .where(eq(threads.id, t.threadId));
  assert.equal(await found(), false);

  await api.db.delete(scheduledEpisodes).where(eq(scheduledEpisodes.threadId, t.threadId));
  assert.equal(await found(), true);

  // Once an episode covers the message there is nothing left to capture.
  await api.db.insert(episodes).values({
    threadId: t.threadId, dataset: t.dataset, projectId, status: 'completed',
    messageCount: 1, startSequence: 1, endSequence: 1,
  });
  assert.equal(await found(), false);
});

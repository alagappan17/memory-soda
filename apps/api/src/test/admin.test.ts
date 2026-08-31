import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApi, type Api } from './harness.ts';

let api: Api;
let token: string;
let userId: string;
before(async () => {
  api = await startApi('admin');
  ({ token, userId } = await api.login());
});
after(() => api.stop());

const call = (method: string, path: string, body?: unknown) =>
  api.call(method, path, { body, token });

test('projects: create, list, update, settings patch, delete', async () => {
  const created = await call('POST', '/dashboard/projects', { name: 'Acme' });
  assert.equal(created.status, 201);
  const id = created.body.project.id;

  const list = await call('GET', '/dashboard/projects');
  assert.ok(list.body.projects.some((p: any) => p.id === id));

  const updated = await call('PATCH', `/dashboard/projects/${id}`, {
    name: 'Acme 2',
    description: 'd',
  });
  assert.equal(updated.body.project.name, 'Acme 2');

  const defaults = await call('GET', `/dashboard/projects/${id}/settings`);
  assert.equal(defaults.body.settings.semantic.factsInContext, 8);

  const patched = await call('PATCH', `/dashboard/projects/${id}/settings`, {
    semantic: { factsInContext: 3 },
  });
  assert.equal(patched.body.settings.semantic.factsInContext, 3);
  // Untouched keys keep their defaults.
  assert.equal(patched.body.settings.episodic.enabled, true);

  const second = await call('PATCH', `/dashboard/projects/${id}/settings`, {
    episodic: { enabled: false },
  });
  assert.equal(
    second.body.settings.semantic.factsInContext,
    3,
    'merge, not replace',
  );
  assert.equal(second.body.settings.episodic.enabled, false);

  const bad = await call('PATCH', `/dashboard/projects/${id}/settings`, {
    semantic: { factsInContext: 0 },
  });
  assert.equal(bad.status, 400);

  assert.equal((await call('DELETE', `/dashboard/projects/${id}`)).status, 204);
  const gone = await call('GET', '/dashboard/projects');
  assert.ok(!gone.body.projects.some((p: any) => p.id === id));
});

test('api keys: create returns plaintext once, list hides it, revoke blocks use', async () => {
  const { projectId } = await api.project();
  const created = await call('POST', '/dashboard/api-keys', {
    name: 'ci',
    projectId,
  });
  assert.equal(created.status, 201);
  const { key, apiKey } = created.body;
  assert.match(key, /^ms_/);
  assert.equal(apiKey.projectId, projectId);

  const list = await call('GET', `/dashboard/api-keys?projectId=${projectId}`);
  const row = list.body.apiKeys.find((k: any) => k.id === apiKey.id);
  assert.ok(row);
  assert.equal(row.key, undefined);
  assert.equal(row.keyPreview, apiKey.keyPreview);

  assert.equal(
    (await api.call('POST', '/v1/threads', { token: key, body: {} })).status,
    201,
  );
  assert.equal(
    (await call('DELETE', `/dashboard/api-keys/${apiKey.id}`)).status,
    204,
  );
  const revoked = await api.call('POST', '/v1/threads', {
    token: key,
    body: {},
  });
  assert.equal(revoked.status, 401);
  assert.equal(revoked.body.error, 'API key has been revoked');

  const unknownProject = await call('POST', '/dashboard/api-keys', {
    name: 'x',
    projectId: '00000000-0000-0000-0000-000000000000',
  });
  assert.equal(unknownProject.status, 404);
});

test('users: create, duplicate conflict, cannot delete self or last user', async () => {
  const created = await call('POST', '/dashboard/users', {
    username: 'second',
    password: 'secret1',
  });
  assert.equal(created.status, 201);
  const secondId = created.body.user.id;

  const dup = await call('POST', '/dashboard/users', {
    username: 'second',
    password: 'secret1',
  });
  assert.equal(dup.status, 409);

  const short = await call('POST', '/dashboard/users', {
    username: 'third',
    password: '123',
  });
  assert.equal(short.status, 400);

  const self = await call('DELETE', `/dashboard/users/${userId}`);
  assert.equal(self.status, 400);
  assert.match(self.body.error, /own account/);

  assert.equal(
    (await call('DELETE', `/dashboard/users/${secondId}`)).status,
    204,
  );
  assert.equal(
    (await call('DELETE', `/dashboard/users/${secondId}`)).status,
    404,
  );

  const users = await call('GET', '/dashboard/users');
  assert.equal(users.body.users.length, 1);
});

test('browse: datasets and threads listing scoped to the project', async () => {
  const { projectId, key } = await api.project();
  const other = await api.project();
  await api.call('POST', '/v1/threads', {
    token: key,
    body: { dataset: 'alice' },
  });
  await api.call('POST', '/v1/threads', {
    token: key,
    body: { dataset: 'alice' },
  });
  await api.call('POST', '/v1/threads', {
    token: other.key,
    body: { dataset: 'bob' },
  });

  const datasets = await call(
    'GET',
    `/dashboard/projects/${projectId}/browse/datasets`,
  );
  assert.equal(datasets.status, 200);
  const names = datasets.body.datasets.map((d: any) => d.dataset);
  assert.deepEqual(names, ['alice']);

  const threads = await call(
    'GET',
    `/dashboard/projects/${projectId}/browse/threads?dataset=alice`,
  );
  assert.equal(threads.status, 200);
  assert.equal(threads.body.threads.length, 2);
});

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApi, type Api } from './harness.ts';

let api: Api;
before(async () => { api = await startApi('auth'); });
after(() => api.stop());

test('health reports postgres ok', async () => {
  const { status, body } = await api.call('GET', '/health');
  assert.equal(status, 200);
  assert.deepEqual(body, { status: 'ok', services: { postgres: 'ok' } });
});

test('login issues a session usable on /auth/me and logout revokes it', async () => {
  const { username } = await api.login();
  const login = await api.call('POST', '/auth/login', {
    body: { username, password: 'password1' },
  });
  assert.equal(login.status, 200);
  assert.match(login.body.token, /^ms_sess_/);
  assert.equal(login.body.user.username, username);

  const me = await api.call('GET', '/auth/me', { token: login.body.token });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.username, username);

  const out = await api.call('POST', '/auth/logout', { token: login.body.token });
  assert.equal(out.status, 204);
  const after = await api.call('GET', '/auth/me', { token: login.body.token });
  assert.equal(after.status, 401);
  assert.equal(after.body.error, 'Session has been revoked');
});

test('login rejects wrong password and unknown user identically', async () => {
  const { username } = await api.login();
  const bad = await api.call('POST', '/auth/login', {
    body: { username, password: 'nope' },
  });
  const unknown = await api.call('POST', '/auth/login', {
    body: { username: 'ghost', password: 'nope' },
  });
  assert.equal(bad.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(bad.body.error, unknown.body.error);
});

test('login validates the body', async () => {
  const res = await api.call('POST', '/auth/login', { body: { username: '' } });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'Invalid request body');
  assert.ok(Array.isArray(res.body.issues));
});

test('/v1 requires a valid, unrevoked API key', async () => {
  assert.equal((await api.call('POST', '/v1/threads')).status, 401);
  assert.equal(
    (await api.call('POST', '/v1/threads', { token: 'ms_bogus' })).status,
    401,
  );
  const { key } = await api.project();
  assert.equal(
    (await api.call('POST', '/v1/threads', { token: key, body: {} })).status,
    201,
  );
});

test('/dashboard/v1 requires a session and a projectId', async () => {
  const { token } = await api.login();
  const { projectId } = await api.project();
  const noProject = await api.call('POST', '/dashboard/v1/threads', {
    token,
    body: {},
  });
  assert.equal(noProject.status, 400);
  const ok = await api.call(
    'POST',
    `/dashboard/v1/threads?projectId=${projectId}`,
    { token, body: {} },
  );
  assert.equal(ok.status, 201);
  assert.equal(ok.body.projectId, projectId);
  assert.equal((await api.call('GET', '/dashboard/projects')).status, 401);
});

test('unknown routes are 404 json', async () => {
  const res = await api.call('GET', '/nope');
  assert.equal(res.status, 404);
  assert.match(res.body.error, /No route/);
});

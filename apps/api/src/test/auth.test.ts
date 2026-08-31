import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApi, type Api } from './harness.ts';

let api: Api;
before(async () => {
  api = await startApi('auth');
});
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

  const out = await api.call('POST', '/auth/logout', {
    token: login.body.token,
  });
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

test('login flags the default password and /auth/password changes it', async () => {
  const { username, token } = await api.login();
  const first = await api.call('POST', '/auth/login', {
    body: { username, password: 'password1' },
  });
  assert.equal(first.body.usingDefaultPassword, false);

  const wrong = await api.call('POST', '/auth/password', {
    token,
    body: { currentPassword: 'nope', newPassword: 'open-sesame' },
  });
  assert.equal(wrong.status, 401);

  const short = await api.call('POST', '/auth/password', {
    token,
    body: { currentPassword: 'password1', newPassword: 'abc' },
  });
  assert.equal(short.status, 400);

  const ok = await api.call('POST', '/auth/password', {
    token,
    body: { currentPassword: 'password1', newPassword: 'open-sesame' },
  });
  assert.equal(ok.status, 204);

  const again = await api.call('POST', '/auth/login', {
    body: { username, password: 'open-sesame' },
  });
  assert.equal(again.status, 200);
  assert.equal(again.body.usingDefaultPassword, true);
  assert.equal(
    (
      await api.call('POST', '/auth/login', {
        body: { username, password: 'password1' },
      })
    ).status,
    401,
  );
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

test('the project-scoped dashboard mount requires a session and a valid projectId', async () => {
  const { token } = await api.login();
  const { projectId } = await api.project();
  // What the playground's SDK client uses.
  const ok = await api.call(
    'POST',
    `/dashboard/projects/${projectId}/v1/threads`,
    { token, body: {} },
  );
  assert.equal(ok.status, 201);
  assert.equal(ok.body.projectId, projectId);
  const badPath = await api.call(
    'POST',
    '/dashboard/projects/nope/v1/threads',
    {
      token,
      body: {},
    },
  );
  assert.equal(badPath.status, 400);
  const noSession = await api.call(
    'POST',
    `/dashboard/projects/${projectId}/v1/threads`,
    { body: {} },
  );
  assert.equal(noSession.status, 401);
  assert.equal((await api.call('GET', '/dashboard/projects')).status, 401);
});

test('unknown routes are 404 json', async () => {
  const res = await api.call('GET', '/nope');
  assert.equal(res.status, 404);
  assert.match(res.body.error, /No route/);
});

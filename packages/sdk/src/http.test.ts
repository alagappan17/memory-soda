import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Http } from './http.ts';
import { ApiError, AuthError, NetworkError } from './errors.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Call = { url: string; init: RequestInit };
/** Replace fetch with a scripted sequence of responses; records every call. */
function script(responses: (Response | Error)[]): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('unexpected extra fetch');
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return calls;
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const http = () =>
  new Http({ baseUrl: 'http://api.test/', apiKey: 'k', maxRetries: 2 });

describe('Http', () => {
  test('sends bearer auth, JSON body and serialized query; strips trailing slash', async () => {
    const calls = script([json(200, { ok: 1 })]);
    const out = await http().request('/v1/x', {
      method: 'POST',
      body: { a: 1 },
      query: { q: 'hi there', limit: 5, skip: undefined, flag: false },
    });
    assert.deepEqual(out, { ok: 1 });
    assert.equal(calls[0]!.url, 'http://api.test/v1/x?q=hi+there&limit=5&flag=false');
    const headers = calls[0]!.init.headers as Record<string, string>;
    assert.equal(headers['Authorization'], 'Bearer k');
    assert.equal(calls[0]!.init.body, '{"a":1}');
    assert.equal(calls[0]!.init.method, 'POST');
  });

  test('GET without query has no body and no ?', async () => {
    const calls = script([json(200, {})]);
    await http().request('/v1/x', { query: { a: undefined } });
    assert.equal(calls[0]!.url, 'http://api.test/v1/x');
    assert.equal(calls[0]!.init.body, undefined);
  });

  test('204 resolves to undefined', async () => {
    script([new Response(null, { status: 204 })]);
    assert.equal(await http().request('/v1/x'), undefined);
  });

  test('401/403 become AuthError and are not retried', async () => {
    const calls = script([json(401, { error: 'nope' })]);
    await assert.rejects(http().request('/v1/x'), AuthError);
    assert.equal(calls.length, 1);
  });

  test('4xx becomes ApiError with the server message, not retried', async () => {
    const calls = script([json(404, { error: 'Thread not found' })]);
    await assert.rejects(http().request('/v1/x'), (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 404);
      assert.equal(err.message, 'Thread not found');
      assert.deepEqual(err.body, { error: 'Thread not found' });
      return true;
    });
    assert.equal(calls.length, 1);
  });

  test('5xx and network failures retry up to maxRetries then surface the last error', async () => {
    const calls = script([json(503, null), new TypeError('ECONNRESET'), json(500, {})]);
    await assert.rejects(http().request('/v1/x'), (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 500);
      assert.equal(err.message, 'Request failed with status 500');
      return true;
    });
    assert.equal(calls.length, 3);
  });

  test('a retry that succeeds returns normally', async () => {
    const calls = script([new TypeError('down'), json(200, { fine: true })]);
    assert.deepEqual(await http().request('/v1/x'), { fine: true });
    assert.equal(calls.length, 2);
  });

  test('network error with retries off is a NetworkError', async () => {
    script([new TypeError('down')]);
    const h = new Http({ baseUrl: 'http://api.test', apiKey: 'k', maxRetries: 0 });
    await assert.rejects(h.request('/v1/x'), NetworkError);
  });

  test('hooks see every request and response', async () => {
    script([json(500, {}), json(200, { a: 1 })]);
    const seen: string[] = [];
    const h = new Http({
      baseUrl: 'http://api.test',
      apiKey: 'k',
      onRequest: (i) => seen.push(`req ${i.method} ${i.path}`),
      onResponse: (i) => seen.push(`res ${i.status}`),
    });
    await h.request('/v1/x');
    assert.deepEqual(seen, ['req GET /v1/x', 'res 500', 'res 200']);
  });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { created, noContent, projectRoute, route } from './route.ts';
import { AppError } from './errors.ts';

/** Drive a handler with a fake req/res and capture what it sends or passes on. */
async function run(
  handler: ReturnType<typeof route>,
  req: Partial<Request>,
  locals: Record<string, unknown> = {},
) {
  const out: { status?: number; body?: unknown; sent?: boolean; err?: unknown } = {};
  const res = {
    headersSent: false,
    locals,
    status(s: number) { out.status = s; return this; },
    json(b: unknown) { out.body = b; },
    send() { out.sent = true; },
  } as unknown as Response;
  await new Promise<void>((resolve) => {
    handler({ body: {}, query: {}, params: {}, ...req } as Request, res, (err) => {
      out.err = err;
      resolve();
    });
    // The handler resolves on the microtask queue; give it a tick.
    setImmediate(resolve);
  });
  return out;
}

test('parses body/query/params and sends the returned value as JSON', async () => {
  const h = route(
    { body: z.object({ n: z.coerce.number() }), params: z.object({ id: z.string() }) },
    async ({ body, params }) => ({ doubled: body.n * 2, id: params.id }),
  );
  const out = await run(h, { body: { n: '21' }, params: { id: 'x' } });
  assert.deepEqual(out.body, { doubled: 42, id: 'x' });
  assert.equal(out.status, undefined);
});

test('invalid input becomes a 400 AppError with issues', async () => {
  const h = route({ body: z.object({ n: z.number() }) }, async () => 'unreachable');
  const out = await run(h, { body: { n: 'nope' } });
  assert.ok(out.err instanceof AppError);
  assert.equal(out.err.status, 400);
  assert.equal(out.err.message, 'Invalid request body');
  assert.ok(Array.isArray(out.err.details));
});

test('created and noContent set their status', async () => {
  const c = await run(route({}, async () => created({ id: 1 })), {});
  assert.equal(c.status, 201);
  assert.deepEqual(c.body, { id: 1 });
  const n = await run(route({}, async () => noContent()), {});
  assert.equal(n.status, 204);
  assert.equal(n.sent, true);
});

test('thrown errors go to next()', async () => {
  const h = route({}, async () => { throw AppError.notFound('Thing'); });
  const out = await run(h, {});
  assert.ok(out.err instanceof AppError);
  assert.equal(out.err.message, 'Thing not found');
});

test('projectRoute passes the guarded projectId and fails loudly without one', async () => {
  const h = projectRoute({}, async ({ projectId }) => ({ projectId }));
  assert.deepEqual((await run(h, {}, { projectId: 'p1' })).body, { projectId: 'p1' });
  const missing = await run(h, {});
  assert.ok(missing.err instanceof AppError);
  assert.equal(missing.err.status, 500);
});

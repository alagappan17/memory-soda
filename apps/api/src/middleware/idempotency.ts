import type { Request, Response, NextFunction } from 'express';
import { and, eq, lt } from 'drizzle-orm';
import { db } from '../db/postgres.js';
import { idempotencyKeys } from '../db/schema.js';
import { ConflictError } from '../lib/errors.js';

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Makes a write endpoint safe to retry. When the client sends an
 * `Idempotency-Key` header, the first successful (2xx) response is persisted and
 * replayed verbatim on any later request reusing the same key within the same
 * project. Requests without the header are passed through unchanged.
 */
export async function idempotency(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers['idempotency-key'];
  const key = Array.isArray(header) ? header[0] : header;
  if (!key || !req.projectId) {
    next();
    return;
  }

  try {
    const [existing] = await db
      .select()
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.projectId, req.projectId),
          eq(idempotencyKeys.key, key),
        ),
      );

    if (existing) {
      if (existing.method !== req.method || existing.path !== req.originalUrl) {
        next(
          new ConflictError(
            'Idempotency-Key already used for a different request',
            'CONFLICT',
          ),
        );
        return;
      }
      res.status(existing.status).json(existing.response);
      return;
    }
  } catch (err) {
    next(err);
    return;
  }

  // Capture the response so it can be stored, then replayed on retry.
  const originalJson = res.json.bind(res);
  res.json = (body: unknown): Response => {
    if (res.statusCode >= 200 && res.statusCode < 300 && req.projectId) {
      db.insert(idempotencyKeys)
        .values({
          projectId: req.projectId,
          key,
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          response: body as object,
        })
        .onConflictDoNothing()
        .catch(() => {});
    }
    return originalJson(body);
  };

  next();
}

export async function reapIdempotencyKeys(): Promise<void> {
  const cutoff = new Date(Date.now() - MAX_AGE_MS);
  await db.delete(idempotencyKeys).where(lt(idempotencyKeys.createdAt, cutoff));
}

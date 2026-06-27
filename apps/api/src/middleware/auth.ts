import type { Request, Response, NextFunction } from 'express';
import type { ApiKeyPayload } from '@memory-soda/types';
import { findApiKeyByValue, touchApiKey } from '../services/api-key.service.js';
import { UnauthorizedError } from '../lib/errors.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      apiKey?: ApiKeyPayload;
      projectId?: string;
    }
  }
}

interface CacheEntry {
  payload: ApiKeyPayload;
  expiresAt: number;
  lastTouchedAt: number;
}

// Short-TTL cache keyed by the raw token. Trades up to CACHE_TTL_MS of staleness
// (a key revoked within the window may still be accepted) for skipping a hashed
// Postgres lookup on every request. `touchApiKey` is throttled to TOUCH_INTERVAL_MS.
const CACHE_TTL_MS = 30_000;
const TOUCH_INTERVAL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

export async function requireApiKey(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    next(new UnauthorizedError('Missing or invalid Authorization header'));
    return;
  }

  const token = authHeader.slice(7);
  const now = Date.now();

  try {
    const cached = cache.get(token);
    if (cached && cached.expiresAt > now) {
      req.apiKey = cached.payload;
      req.projectId = cached.payload.projectId;
      maybeTouch(token, cached, now);
      next();
      return;
    }

    const row = await findApiKeyByValue(token);
    if (!row) {
      cache.delete(token);
      next(new UnauthorizedError('Invalid API key'));
      return;
    }
    if (row.revokedAt) {
      cache.delete(token);
      next(new UnauthorizedError('API key has been revoked'));
      return;
    }
    if (!row.projectId) {
      next(new UnauthorizedError('API key is not linked to a project'));
      return;
    }

    const payload: ApiKeyPayload = {
      keyId: row.id,
      projectId: row.projectId,
      name: row.name,
    };
    const entry: CacheEntry = {
      payload,
      expiresAt: now + CACHE_TTL_MS,
      lastTouchedAt: 0,
    };
    cache.set(token, entry);
    req.apiKey = payload;
    req.projectId = row.projectId;
    maybeTouch(token, entry, now);
    next();
  } catch (err) {
    next(err);
  }
}

function maybeTouch(token: string, entry: CacheEntry, now: number): void {
  if (now - entry.lastTouchedAt < TOUCH_INTERVAL_MS) return;
  entry.lastTouchedAt = now;
  touchApiKey(entry.payload.keyId).catch(() => {
    // Best-effort; reset so a later request retries the write.
    entry.lastTouchedAt = 0;
  });
}

import type { Request, Response, NextFunction } from 'express';
import type { SessionUser } from '@memory-soda/types';
import {
  findSessionByValue,
  touchSession,
} from '../services/session.service.js';
import { db } from '../db/postgres.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
      sessionId?: string;
    }
  }
}

/**
 * Guards dashboard routes with a login session. Expects
 * `Authorization: Bearer <session token>`. Rejects missing / revoked / expired
 * sessions with 401 and attaches `req.user` on success.
 */
export async function requireSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const session = await findSessionByValue(token);

    if (!session) {
      res.status(401).json({ error: 'Invalid session' });
      return;
    }

    if (session.revokedAt) {
      res.status(401).json({ error: 'Session has been revoked' });
      return;
    }

    if (session.expiresAt.getTime() < Date.now()) {
      res.status(401).json({ error: 'Session has expired' });
      return;
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);

    if (!user) {
      res.status(401).json({ error: 'Session user no longer exists' });
      return;
    }

    // Non-blocking last-used update.
    touchSession(session.id).catch(() => {});

    req.user = { userId: user.id, username: user.username };
    req.sessionId = session.id;
    next();
  } catch (err) {
    console.error('[session] error checking session:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

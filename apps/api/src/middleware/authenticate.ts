import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError } from '../lib/errors.js';
import { bearerToken } from '../lib/opaque-token.js';
import {
  findApiKeyByValue,
  touchApiKey,
} from '../services/api-key.service.js';
import { findSessionByValue, touchSession } from '../services/session.service.js';
import { getUserById } from '../services/user.service.js';

/**
 * Both credentials the API accepts are opaque bearer tokens looked up by hash,
 * checked for revocation, and stamped with a last-used time. Only the lookup
 * and the failure wording differ, so the shape lives here once.
 */
function bearerAuth(
  authenticate: (token: string, res: Response) => Promise<void>,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = bearerToken(req.headers.authorization);
    if (!token) {
      next(AppError.unauthorized('Missing or invalid Authorization header'));
      return;
    }
    authenticate(token, res).then(() => next(), next);
  };
}

/** SDK credential. Establishes the project every `/v1` route operates on. */
export const requireApiKey = bearerAuth(async (token, res) => {
  const row = await findApiKeyByValue(token);
  if (!row) throw AppError.unauthorized('Invalid API key');
  if (row.revokedAt) throw AppError.unauthorized('API key has been revoked');

  // Non-blocking: a failed timestamp update must not fail the request.
  void touchApiKey(row.id).catch(() => {});

  res.locals.projectId = row.projectId;
  res.locals.apiKey = { keyId: row.id, name: row.name };
});

/** Dashboard credential. Establishes the signed-in user. */
export const requireSession = bearerAuth(async (token, res) => {
  const session = await findSessionByValue(token);
  if (!session) throw AppError.unauthorized('Invalid session');
  if (session.revokedAt) throw AppError.unauthorized('Session has been revoked');
  if (session.expiresAt.getTime() < Date.now()) {
    throw AppError.unauthorized('Session has expired');
  }

  const user = await getUserById(session.userId);
  if (!user) throw AppError.unauthorized('Session user no longer exists');

  void touchSession(session.id).catch(() => {});

  res.locals.session = {
    sessionId: session.id,
    userId: user.id,
    username: user.username,
  };
});

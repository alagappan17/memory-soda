import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  DEFAULT_ADMIN_PASSWORD,
  type ChangePasswordBody,
  type LoginResponse,
} from '@memory-soda/types';
import { noContent, route } from '../lib/route.js';
import { AppError } from '../lib/errors.js';
import { requireSession } from '../middleware/authenticate.js';
import {
  getUserById,
  getUserByUsername,
  updateUserPasswordHash,
} from '../services/user.service.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { createSession, revokeSession } from '../services/session.service.js';

const router = Router();

const loginBody = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const changePasswordBody: z.ZodType<ChangePasswordBody> = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6, 'New password must be at least 6 characters'),
});

/**
 * A throwaway hash, derived once with the current parameters.
 *
 * An unknown username is verified against it so both branches of the login path
 * spend the same scrypt time. Skipping the work for an unknown user returns
 * hundreds of milliseconds earlier, and that difference enumerates valid
 * usernames.
 */
let dummyHash: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(32).toString('hex'));
  return dummyHash;
}
// Warmed at startup so the first unknown-username login isn't the slow one.
void getDummyHash();

router.post(
  '/login',
  route({ body: loginBody }, async ({ body }) => {
    const row = await getUserByUsername(body.username);

    // Verification always runs, against the user's hash, or a dummy of the
    // same cost, then rejects uniformly.
    const { ok, needsRehash } = await verifyPassword(
      body.password,
      row?.passwordHash ?? (await getDummyHash()),
    );
    if (!row || !ok) {
      throw AppError.unauthorized('Invalid username or password');
    }

    // The password is right but the hash predates the current scrypt
    // parameters. Upgrade it in the background; a failure must not fail login.
    if (needsRehash) {
      void hashPassword(body.password)
        .then((fresh) => updateUserPasswordHash(row.id, fresh))
        .catch((err) => console.error('[auth] password rehash failed:', err));
    }

    const { token } = await createSession(row.id);
    const response: LoginResponse = {
      token,
      user: {
        id: row.id,
        username: row.username,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      },
      usingDefaultPassword: body.password === DEFAULT_ADMIN_PASSWORD,
    };
    return response;
  }),
);

router.post(
  '/password',
  requireSession,
  route({ body: changePasswordBody }, async ({ body, res }) => {
    const userId = res.locals.session?.userId;
    const row = userId ? await getUserById(userId) : null;
    if (!row) throw AppError.unauthorized('Session user no longer exists');
    const { ok } = await verifyPassword(body.currentPassword, row.passwordHash);
    if (!ok) throw AppError.unauthorized('Current password is incorrect');
    await updateUserPasswordHash(row.id, await hashPassword(body.newPassword));
    return noContent();
  }),
);

router.post(
  '/logout',
  requireSession,
  route({}, async ({ res }) => {
    const sessionId = res.locals.session?.sessionId;
    if (sessionId) await revokeSession(sessionId);
    return noContent();
  }),
);

router.get(
  '/me',
  requireSession,
  route({}, async ({ res }) => ({
    user: {
      userId: res.locals.session?.userId,
      username: res.locals.session?.username,
    },
  })),
);

export default router;

import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { LoginResponse } from '@memory-soda/types';
import { noContent, route } from '../lib/route.js';
import { AppError } from '../lib/errors.js';
import { requireSession } from '../middleware/authenticate.js';
import {
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

    // Verification always runs — against the user's hash, or a dummy of the
    // same cost — then rejects uniformly.
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
    };
    return response;
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

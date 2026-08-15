import { Router } from 'express';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import type { LoginResponse, User } from '@memory-soda/types';
import { validateBody } from '../middleware/validate.js';
import { requireSession } from '../middleware/session.js';
import {
  getUserByUsername,
  updateUserPasswordHash,
} from '../services/user.service.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import {
  createSession,
  revokeSession,
} from '../services/session.service.js';

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

/**
 * A throwaway hash, derived once with the current parameters. An unknown
 * username is verified against it so both branches of the login path spend the
 * same scrypt time — otherwise the unknown-username branch returns hundreds of
 * milliseconds earlier and response latency enumerates valid usernames.
 */
let dummyHash: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(32).toString('hex'));
  return dummyHash;
}
// Warm it at startup so the first unknown-username login isn't slower than the rest.
void getDummyHash();

/**
 * @route POST /auth/login
 * @description Authenticate with username + password and start a session.
 * @body {{ username: string, password: string }}
 * @returns {{ token: string, user: User }}
 */
router.post('/login', validateBody(loginSchema), async (req, res) => {
  try {
    const { username, password } = req.body as z.infer<typeof loginSchema>;
    const row = await getUserByUsername(username);

    // Verification always runs — against the user's hash, or against a dummy of
    // the same cost when the username is unknown — then rejects uniformly.
    const { ok, needsRehash } = await verifyPassword(
      password,
      row?.passwordHash ?? (await getDummyHash()),
    );
    if (!row || !ok) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    // The password is correct but the hash predates the current scrypt
    // parameters — upgrade it in the background; a failure here must not fail
    // the login.
    if (needsRehash) {
      hashPassword(password)
        .then((fresh) => updateUserPasswordHash(row.id, fresh))
        .catch((err) => console.error('[auth] password rehash failed:', err));
    }

    const { token } = await createSession(row.id);
    const user: User = {
      id: row.id,
      username: row.username,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
    const body: LoginResponse = { token, user };
    res.json(body);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to log in' });
  }
});

/**
 * @route POST /auth/logout
 * @description Revoke the current session.
 * @returns 204 No Content
 */
router.post('/logout', requireSession, async (req, res) => {
  try {
    if (req.sessionId) await revokeSession(req.sessionId);
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to log out' });
  }
});

/**
 * @route GET /auth/me
 * @description Return the currently authenticated user.
 * @returns {{ user: { id: string, username: string } }}
 */
router.get('/me', requireSession, (req, res) => {
  res.json({ user: req.user });
});

export default router;

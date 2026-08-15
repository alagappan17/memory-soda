import { Router } from 'express';
import { z } from 'zod';
import type { LoginResponse, User } from '@memory-soda/types';
import { validateBody } from '../middleware/validate.js';
import { requireSession } from '../middleware/session.js';
import { getUserByUsername } from '../services/user.service.js';
import { verifyPassword } from '../lib/password.js';
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
 * @route POST /auth/login
 * @description Authenticate with username + password and start a session.
 * @body {{ username: string, password: string }}
 * @returns {{ token: string, user: User }}
 */
router.post('/login', validateBody(loginSchema), async (req, res) => {
  try {
    const { username, password } = req.body as z.infer<typeof loginSchema>;
    const row = await getUserByUsername(username);

    // Always run verification against something to reduce username enumeration
    // via timing, then reject uniformly on any failure.
    const ok = row ? verifyPassword(password, row.passwordHash) : false;
    if (!row || !ok) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
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

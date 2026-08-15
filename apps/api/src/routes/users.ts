import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate.js';
import {
  createUser,
  listUsers,
  deleteUser,
  getUserByUsername,
  countUsers,
} from '../services/user.service.js';

const router = Router();

const createBodySchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(6).max(200),
});

/**
 * @route GET /dashboard/users
 * @description List all dashboard users. Password hashes are never returned.
 * @returns {{ users: User[] }}
 */
router.get('/', async (_req, res) => {
  try {
    const users = await listUsers();
    res.json({ users });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

/**
 * @route POST /dashboard/users
 * @description Create a new dashboard user.
 * @body {{ username: string, password: string }}
 * @returns {{ user: User }}
 */
router.post('/', validateBody(createBodySchema), async (req, res) => {
  try {
    const { username, password } = req.body as z.infer<typeof createBodySchema>;
    const existing = await getUserByUsername(username);
    if (existing) {
      res.status(409).json({ error: 'Username already taken' });
      return;
    }
    const user = await createUser(username, password);
    res.status(201).json({ user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

/**
 * @route DELETE /dashboard/users/:id
 * @description Delete a user. Blocked if the target is the current user, or if
 *   it would remove the last remaining user (either would lock someone out).
 * @returns 204 No Content
 */
router.delete('/:id', async (req, res) => {
  try {
    const targetId = req.params['id']!;

    if (req.user?.userId === targetId) {
      res.status(400).json({ error: 'You cannot delete your own account' });
      return;
    }

    const total = await countUsers();
    if (total <= 1) {
      res.status(400).json({ error: 'Cannot delete the last user' });
      return;
    }

    await deleteUser(targetId);
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;

import { Router } from 'express';
import { z } from 'zod';
import { listThreads, getThreadWithMessages } from '../services/dashboard.service.js';

const router = Router();

const listThreadsSchema = z.object({
  userId: z.string().optional(),
  limit:  z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * @route GET /dashboard/threads
 * @description List all threads across the system, optionally filtered by userId.
 * @queryparam {string} [userId] - Filter threads by user ID.
 * @queryparam {number} [limit=20] - Max number of threads to return (1–100).
 * @queryparam {number} [offset=0] - Pagination offset.
 * @returns {{ threads: WMThread[], total: number }}
 */
router.get('/', async (req, res) => {
  const parsed = listThreadsSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', issues: parsed.error.issues });
    return;
  }
  try {
    const result = await listThreads(parsed.data);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list threads' });
  }
});

/**
 * @route GET /dashboard/threads/:threadId/messages
 * @description Fetch a thread and its full message history for dashboard inspection.
 * @param {string} threadId - The thread ID.
 * @returns {{ thread: WMThread, messages: WMMessage[] }}
 * @throws 404 if the thread does not exist.
 */
router.get('/:threadId/messages', async (req, res) => {
  try {
    const result = await getThreadWithMessages(req.params.threadId);
    if (!result) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load thread' });
  }
});

export default router;

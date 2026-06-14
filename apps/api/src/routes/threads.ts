import { Router } from 'express';
import { z } from 'zod';
import { listThreads, getThreadWithMessages } from '../services/dashboard.service.js';
import { getThreadEpisodes } from '../services/episodic-memory.service.js';

const router = Router();

const listThreadsSchema = z.object({
  projectId: z.string().uuid(),
  userId: z.string().optional(),
  limit:  z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const threadMessagesSchema = z.object({
  projectId: z.string().uuid(),
});

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

router.get('/:threadId/messages', async (req, res) => {
  const parsed = threadMessagesSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', issues: parsed.error.issues });
    return;
  }
  try {
    const result = await getThreadWithMessages(req.params.threadId, parsed.data.projectId);
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

router.get('/:threadId/episodes', async (req, res) => {
  const parsed = threadMessagesSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', issues: parsed.error.issues });
    return;
  }
  try {
    const episodes = await getThreadEpisodes(req.params.threadId, parsed.data.projectId);
    res.json({ episodes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load episodes' });
  }
});

export default router;

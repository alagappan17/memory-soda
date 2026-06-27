import { Router } from 'express';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { validateQuery } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { NotFoundError } from '../lib/errors.js';
import { listThreads, getThreadWithMessages } from '../services/dashboard.service.js';
import { getThreadEpisodes } from '../services/episodic-memory.service.js';
import { querySemanticFacts } from '../services/semantic-memory.service.js';
import { db } from '../db/postgres.js';
import { threads } from '../db/schema.js';

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

router.get(
  '/',
  validateQuery(listThreadsSchema),
  asyncHandler(async (req, res) => {
    const result = await listThreads(req.query as unknown as z.infer<typeof listThreadsSchema>);
    res.json(result);
  }),
);

router.get(
  '/:threadId/messages',
  validateQuery(threadMessagesSchema),
  asyncHandler(async (req, res) => {
    const { projectId } = req.query as unknown as z.infer<typeof threadMessagesSchema>;
    const result = await getThreadWithMessages(req.params.threadId, projectId);
    if (!result) throw new NotFoundError('Thread not found', 'THREAD_NOT_FOUND');
    res.json(result);
  }),
);

router.get(
  '/:threadId/episodes',
  validateQuery(threadMessagesSchema),
  asyncHandler(async (req, res) => {
    const { projectId } = req.query as unknown as z.infer<typeof threadMessagesSchema>;
    const episodes = await getThreadEpisodes(req.params.threadId, projectId);
    res.json({ episodes });
  }),
);

router.get(
  '/:threadId/facts',
  validateQuery(threadMessagesSchema),
  asyncHandler(async (req, res) => {
    const { projectId } = req.query as unknown as z.infer<typeof threadMessagesSchema>;
    const [thread] = await db
      .select({ userId: threads.userId })
      .from(threads)
      .where(and(eq(threads.id, req.params.threadId), eq(threads.projectId, projectId)));
    if (!thread) throw new NotFoundError('Thread not found', 'THREAD_NOT_FOUND');
    const { facts, total } = await querySemanticFacts(thread.userId, projectId, undefined, 200, false);
    res.json({ facts, total });
  }),
);

export default router;

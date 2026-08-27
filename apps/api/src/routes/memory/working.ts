import { Router } from 'express';
import { z } from 'zod';
import { created, projectRoute } from '../../lib/route.js';
import { AppError } from '../../lib/errors.js';
import {
  addMessage,
  listMessages,
  prepareThread,
  compactThread,
  getThreadStats,
} from '../../services/working-memory.service.js';

const router = Router();

const threadParams = z.object({ threadId: z.string().uuid() });

const addMessageBody = z.object({
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string().min(1),
  tokens: z
    .object({
      input: z.number().int().nonnegative().optional(),
      output: z.number().int().nonnegative().optional(),
      total: z.number().int().nonnegative().optional(),
    })
    .optional(),
  model: z.string().optional(),
  latencyMs: z.number().int().nonnegative().optional(),
  metadata: z
    .object({
      stopReason: z.string().optional(),
      agentName: z.string().optional(),
    })
    .optional(),
});

const listMessagesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  before: z.coerce.number().int().positive().optional(),
  order: z.enum(['asc', 'desc']).default('asc'),
});

const prepareBody = z.object({
  messageLimit: z.number().int().min(1).max(100).default(20),
});

router.post(
  '/threads/:threadId/messages',
  projectRoute(
    { params: threadParams, body: addMessageBody },
    async ({ params, body, projectId }) => {
      const { message, compacted } = await addMessage(
        params.threadId,
        projectId,
        body,
      );
      return created({
        messageId: message.messageId,
        threadId: message.threadId,
        sequenceNumber: message.sequenceNumber,
        role: message.role,
        createdAt: message.createdAt,
        compacted,
      });
    },
  ),
);

router.get(
  '/threads/:threadId/messages',
  projectRoute(
    { params: threadParams, query: listMessagesQuery },
    async ({ params, query, projectId }) => {
      const result = await listMessages(params.threadId, projectId, query);
      if (!result) throw AppError.notFound('Thread');
      return result;
    },
  ),
);

/** The thread state to feed the next model call. Pure SQL, no LLM. */
router.post(
  '/threads/:threadId/prepare',
  projectRoute(
    { params: threadParams, body: prepareBody },
    async ({ params, body, projectId }) => {
      const result = await prepareThread(params.threadId, projectId, body);
      if (!result) throw AppError.notFound('Thread');
      return result;
    },
  ),
);

/** Fold the thread's un-compacted messages into a single rolling summary. */
router.post(
  '/threads/:threadId/compact',
  projectRoute({ params: threadParams }, async ({ params, projectId }) => {
    const result = await compactThread(params.threadId, projectId);
    if (result === null) throw AppError.notFound('Thread');
    if (result === false) {
      return { ok: true, compacted: false, message: 'Nothing to compact' };
    }
    return result;
  }),
);

router.get(
  '/threads/:threadId/stats',
  projectRoute({ params: threadParams }, async ({ params, projectId }) => {
    const result = await getThreadStats(params.threadId, projectId);
    if (!result) throw AppError.notFound('Thread');
    return result;
  }),
);

export default router;

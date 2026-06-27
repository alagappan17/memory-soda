import { Router } from 'express';
import { z } from 'zod';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { idempotency } from '../middleware/idempotency.js';
import { NotFoundError } from '../lib/errors.js';
import {
  addMessage,
  listMessages,
  compactThread,
  getThreadStats,
} from '../services/working-memory.service.js';
import { prepareThread } from '../services/memory.service.js';

const router = Router();

// ── Schemas ───────────────────────────────────────────────────────────────────

const addMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string().min(1),
  tokenCount: z
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

const listMessagesSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  before: z.coerce.number().int().positive().optional(),
  order: z.enum(['asc', 'desc']).default('asc'),
});

const prepareSchema = z.object({
  messageLimit: z.number().int().min(1).max(100).optional(),
  query: z.string().max(1000).optional(),
});

// ── Message routes ────────────────────────────────────────────────────────────

router.post(
  '/:threadId/messages',
  idempotency,
  validateBody(addMessageSchema),
  asyncHandler(async (req, res) => {
    const { role, content, tokenCount, model, latencyMs, metadata } =
      req.body as z.infer<typeof addMessageSchema>;
    const { message, compacted } = await addMessage(
      req.params.threadId,
      req.projectId!,
      role,
      content,
      tokenCount,
      model,
      latencyMs,
      metadata,
    );
    res.status(201).json({
      messageId: message.messageId,
      threadId: message.threadId,
      sequenceNumber: message.sequenceNumber,
      role: message.role,
      createdAt: message.createdAt,
      compacted,
    });
  }),
);

router.get(
  '/:threadId/messages',
  validateQuery(listMessagesSchema),
  asyncHandler(async (req, res) => {
    const { limit, before, order } = req.query as unknown as z.infer<
      typeof listMessagesSchema
    >;
    const result = await listMessages(req.params.threadId, req.projectId!, {
      limit,
      before,
      order,
    });
    if (!result) throw new NotFoundError('Thread not found', 'THREAD_NOT_FOUND');
    res.json(result);
  }),
);

// ── Prepare ───────────────────────────────────────────────────────────────────

router.post(
  '/:threadId/prepare',
  validateBody(prepareSchema.partial()),
  asyncHandler(async (req, res) => {
    const parsed = prepareSchema.parse(req.body ?? {});
    const result = await prepareThread(
      req.params.threadId,
      req.projectId!,
      parsed.messageLimit,
      parsed.query,
    );
    if (!result) throw new NotFoundError('Thread not found', 'THREAD_NOT_FOUND');
    res.json(result);
  }),
);

// ── Compact ───────────────────────────────────────────────────────────────────

router.post(
  '/:threadId/compact',
  asyncHandler(async (req, res) => {
    const result = await compactThread(req.params.threadId, req.projectId!);
    if (result === null) throw new NotFoundError('Thread not found', 'THREAD_NOT_FOUND');
    if (result === false) {
      res.status(200).json({ ok: true, compacted: false, message: 'Nothing to compact' });
      return;
    }
    res.json(result);
  }),
);

// ── Stats ─────────────────────────────────────────────────────────────────────

router.get(
  '/:threadId/stats',
  asyncHandler(async (req, res) => {
    const result = await getThreadStats(req.params.threadId, req.projectId!);
    if (!result) throw new NotFoundError('Thread not found', 'THREAD_NOT_FOUND');
    res.json(result);
  }),
);

export default router;

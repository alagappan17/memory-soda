import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate.js';
import {
  createThread,
  getThread,
  updateThreadMetadata,
  endThread,
  addMessage,
  listMessages,
  prepareThread,
  getThreadStats,
} from '../services/working-memory.service.js';

const router = Router();

// ── Schemas ──────────────────────────────────────────────────────────────────

const createThreadSchema = z.object({
  userId:   z.string().min(1).optional(),
  tags:     z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const patchThreadSchema = z.object({
  metadata: z.record(z.unknown()),
});

const addMessageSchema = z.object({
  role:      z.enum(['user', 'assistant', 'system', 'tool']),
  content:   z.string().min(1),
  tokenCount: z.object({
    input:  z.number().int().nonnegative().optional(),
    output: z.number().int().nonnegative().optional(),
    total:  z.number().int().nonnegative().optional(),
  }).optional(),
  model:     z.string().optional(),
  latencyMs: z.number().int().nonnegative().optional(),
  metadata: z.object({
    stopReason: z.string().optional(),
    agentName:  z.string().optional(),
  }).optional(),
});

const listMessagesSchema = z.object({
  limit:  z.coerce.number().int().min(1).max(100).default(20),
  before: z.coerce.number().int().positive().optional(),
  order:  z.enum(['asc', 'desc']).default('asc'),
});

const prepareSchema = z.object({
  messageLimit: z.number().int().min(1).max(100).default(20),
});

// ── Thread routes ────────────────────────────────────────────────────────────

/**
 * @route POST /v1/memory/working/threads
 * @description Create a new conversation thread. `userId` is auto-generated if omitted.
 * @auth API key required
 * @body {{ userId?: string, tags?: string[], metadata?: Record<string, unknown> }}
 * @returns {{ threadId: string, userId: string, createdAt: string }}
 */
router.post('/threads', validateBody(createThreadSchema), async (req, res) => {
  try {
    const { userId, tags, metadata } = req.body as z.infer<typeof createThreadSchema>;
    const apiKeyId = req.apiKey!.keyId;
    const thread = await createThread(apiKeyId, userId, tags, metadata);
    res.status(201).json({
      threadId: thread.threadId,
      userId: thread.userId,
      createdAt: thread.createdAt,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create thread' });
  }
});

/**
 * @route GET /v1/memory/working/threads/:threadId
 * @description Fetch a thread by ID. Only accessible with the API key used to create it.
 * @auth API key required
 * @param {string} threadId
 * @returns {WMThread}
 * @throws 404 if not found or the key does not own the thread.
 */
router.get('/threads/:threadId', async (req, res) => {
  try {
    const thread = await getThread(req.params.threadId, req.apiKey!.keyId);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }
    res.json({
      threadId: thread.threadId,
      userId: thread.userId,
      messageCount: thread.messageCount,
      metadata: thread.metadata,
      createdAt: thread.createdAt,
      lastActivityAt: thread.lastActivityAt,
      endedAt: thread.endedAt,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to get thread' });
  }
});

/**
 * @route PATCH /v1/memory/working/threads/:threadId
 * @description Merge-update a thread's metadata. Existing keys are preserved; only provided keys are overwritten.
 * @auth API key required
 * @param {string} threadId
 * @body {{ metadata: Record<string, unknown> }}
 * @returns {WMThread}
 */
router.patch(
  '/threads/:threadId',
  validateBody(patchThreadSchema),
  async (req, res) => {
    try {
      const { metadata } = req.body as z.infer<typeof patchThreadSchema>;
      const thread = await updateThreadMetadata(
        req.params.threadId,
        req.apiKey!.keyId,
        metadata,
      );
      if (!thread) {
        res.status(404).json({ error: 'Thread not found' });
        return;
      }
      res.json({
        threadId: thread.threadId,
        userId: thread.userId,
        messageCount: thread.messageCount,
        metadata: thread.metadata,
        createdAt: thread.createdAt,
        lastActivityAt: thread.lastActivityAt,
        endedAt: thread.endedAt,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to update thread' });
    }
  },
);

/**
 * @route POST /v1/memory/working/threads/:threadId/end
 * @description Mark a thread as ended. Sets `endedAt`; thread becomes read-only.
 * @auth API key required
 * @param {string} threadId
 * @returns {{ threadId: string, endedAt: string }}
 */
router.post('/threads/:threadId/end', async (req, res) => {
  try {
    const thread = await endThread(req.params.threadId, req.apiKey!.keyId);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }
    res.json({
      threadId: thread.threadId,
      endedAt: thread.endedAt,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to end thread' });
  }
});

// ── Message routes ───────────────────────────────────────────────────────────

/**
 * @route POST /v1/memory/working/threads/:threadId/messages
 * @description Append a message to a thread. `sequenceNumber` is assigned automatically.
 * @auth API key required
 * @param {string} threadId
 * @body {{ role: MessageRole, content: string, tokenCount?: WMTokenCount, model?: string, latencyMs?: number, metadata?: WMMessageMetadata }}
 * @returns {{ messageId: string, threadId: string, sequenceNumber: number, role: MessageRole, createdAt: string }}
 * @throws 404 if the thread does not exist.
 */
router.post(
  '/threads/:threadId/messages',
  validateBody(addMessageSchema),
  async (req, res) => {
    try {
      const { role, content, tokenCount, model, latencyMs, metadata } = req.body as z.infer<
        typeof addMessageSchema
      >;
      const { message } = await addMessage(
        req.params.threadId,
        req.apiKey!.keyId,
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
      });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_FOUND') {
        res.status(404).json({ error: 'Thread not found' });
        return;
      }
      console.error(err);
      res.status(500).json({ error: 'Failed to add message' });
    }
  },
);

/**
 * @route GET /v1/memory/working/threads/:threadId/messages
 * @description List messages with cursor-based pagination.
 * @auth API key required
 * @param {string} threadId
 * @queryparam {number} [limit=20] - Max messages to return (1–100).
 * @queryparam {number} [before] - Return messages with sequenceNumber < this value.
 * @queryparam {'asc'|'desc'} [order=asc] - Sort order by sequenceNumber.
 * @returns {{ messages: WMMessage[], total: number, hasMore: boolean }}
 */
router.get('/threads/:threadId/messages', async (req, res) => {
  const parsed = listMessagesSchema.safeParse(req.query);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: 'Validation error', issues: parsed.error.issues });
    return;
  }
  try {
    const { limit, before, order } = parsed.data;
    const result = await listMessages(req.params.threadId, req.apiKey!.keyId, {
      limit,
      before,
      order,
    });
    if (!result) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list messages' });
  }
});

// ── Prepare ──────────────────────────────────────────────────────────────────

/**
 * @route POST /v1/memory/working/threads/:threadId/prepare
 * @description Return the last N messages formatted for LLM injection. Call this before every LLM turn.
 * Result is cached for 5 seconds per thread.
 * @auth API key required
 * @param {string} threadId
 * @body {{ messageLimit?: number }} - Defaults to 20.
 * @returns {{ threadId: string, messages: { role: string, content: string }[], messageCount: number, truncated: boolean }}
 */
router.post(
  '/threads/:threadId/prepare',
  validateBody(prepareSchema.partial()),
  async (req, res) => {
    try {
      const parsed = prepareSchema.parse(req.body ?? {});
      const result = await prepareThread(
        req.params.threadId,
        req.apiKey!.keyId,
        parsed.messageLimit,
      );
      if (!result) {
        res.status(404).json({ error: 'Thread not found' });
        return;
      }
      res.json(result);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to prepare thread' });
    }
  },
);

// ── Stats ────────────────────────────────────────────────────────────────────

/**
 * @route GET /v1/memory/working/threads/:threadId/stats
 * @description Token usage and session duration stats for a thread.
 * @auth API key required
 * @param {string} threadId
 * @returns {WMThreadStatsResponse}
 */
router.get('/threads/:threadId/stats', async (req, res) => {
  try {
    const result = await getThreadStats(
      req.params.threadId,
      req.apiKey!.keyId,
    );
    if (!result) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to get thread stats' });
  }
});

export default router;

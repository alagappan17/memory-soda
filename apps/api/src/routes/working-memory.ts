import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate.js';
import {
  addMessage,
  listMessages,
  prepareThread,
  compactThread,
  getThreadStats,
} from '../services/working-memory.service.js';
import { generateReply } from '../lib/gemini.js';

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
  messageLimit: z.number().int().min(1).max(100).default(20),
  query: z.string().max(1000).optional(),
  include: z.array(z.enum(['episodes', 'synthesis', 'raw'])).optional(),
});

const chatSchema = z.object({
  content: z.string().min(1),
  systemPrompt: z.string().optional(),
  messageLimit: z.number().int().min(1).max(100).default(20),
});

// ── Message routes ────────────────────────────────────────────────────────────

router.post(
  '/threads/:threadId/messages',
  validateBody(addMessageSchema),
  async (req, res) => {
    try {
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
    const result = await listMessages(req.params.threadId, req.projectId!, {
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

// ── Prepare ───────────────────────────────────────────────────────────────────

router.post(
  '/threads/:threadId/prepare',
  validateBody(prepareSchema.partial()),
  async (req, res) => {
    try {
      const parsed = prepareSchema.parse(req.body ?? {});
      const result = await prepareThread(req.params.threadId, req.projectId!, {
        messageLimit: parsed.messageLimit,
        query: parsed.query,
        include: parsed.include,
      });
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

// ── Chat ──────────────────────────────────────────────────────────────────────

router.post(
  '/threads/:threadId/chat',
  validateBody(chatSchema),
  async (req, res) => {
    try {
      const { content, systemPrompt, messageLimit } = req.body as z.infer<
        typeof chatSchema
      >;
      const projectId = req.projectId!;
      const threadId = req.params.threadId;

      const { message: userMessage } = await addMessage(
        threadId,
        projectId,
        'user',
        content,
      );

      const prepared = await prepareThread(threadId, projectId, {
        messageLimit,
        query: content,
        include: ['episodes'],
      });
      if (!prepared) {
        res.status(404).json({ error: 'Thread not found' });
        return;
      }

      const replyContent = await generateReply(
        prepared.messages,
        systemPrompt,
        prepared.episodes,
        prepared.context,
      );

      const { message: assistantMessage, compacted: assistantCompacted } =
        await addMessage(threadId, projectId, 'assistant', replyContent);

      res.status(201).json({
        userMessage: {
          messageId: userMessage.messageId,
          sequenceNumber: userMessage.sequenceNumber,
          role: userMessage.role,
          createdAt: userMessage.createdAt,
        },
        assistantMessage: {
          messageId: assistantMessage.messageId,
          sequenceNumber: assistantMessage.sequenceNumber,
          role: assistantMessage.role,
          content: assistantMessage.content,
          createdAt: assistantMessage.createdAt,
        },
        compacted: assistantCompacted,
        prepare: {
          messageCount: prepared.messageCount,
          truncated: prepared.truncated,
          compacted: prepared.compacted,
          episodeCount: prepared.episodes?.episodeCount ?? 0,
          hasContext: prepared.context.length > 0,
        },
      });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_FOUND') {
        res.status(404).json({ error: 'Thread not found' });
        return;
      }
      console.error(err);
      res.status(500).json({ error: 'Failed to generate reply' });
    }
  },
);

// ── Compact ───────────────────────────────────────────────────────────────────

router.post('/threads/:threadId/compact', async (req, res) => {
  try {
    const result = await compactThread(req.params.threadId, req.projectId!);
    if (result === null) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }
    if (result === false) {
      res
        .status(200)
        .json({ ok: true, compacted: false, message: 'Nothing to compact' });
      return;
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to compact thread' });
  }
});

// ── Stats ─────────────────────────────────────────────────────────────────────

router.get('/threads/:threadId/stats', async (req, res) => {
  try {
    const result = await getThreadStats(req.params.threadId, req.projectId!);
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

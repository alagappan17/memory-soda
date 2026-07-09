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
import { recall } from '../services/recall.service.js';
import { generateReply } from '../lib/gemini.js';
import type { RecallResponse, WMChatResponse } from '@memory-soda/types';

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
});

const chatSchema = z.object({
  content: z.string().min(1),
  systemPrompt: z.string().optional(),
  messageLimit: z.number().int().min(1).max(100).default(20),
  verbose: z.boolean().optional(),
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
      const { content, systemPrompt, messageLimit, verbose } =
        req.body as z.infer<typeof chatSchema>;
      const projectId = req.projectId!;
      const threadId = req.params.threadId;

      const { message: userMessage, thread } = await addMessage(
        threadId,
        projectId,
        'user',
        content,
      );

      // Working memory (prepare) and long-term memory (recall) are independent
      // reads — prepare is pure SQL, recall does the embedding/LLM work — so
      // they run in parallel; addMessage already gave us the thread's dataset.
      // recall() is best-effort: the user message is already persisted above,
      // so a recall failure must not 500 the whole chat turn.
      const [prepared, recalled] = await Promise.all([
        prepareThread(threadId, projectId, { messageLimit }),
        recall(projectId, {
          dataset: thread.dataset,
          query: content,
          include: ['episodes', 'synthesis', 'raw'],
        }).catch((err): RecallResponse => {
          console.error('[chat] recall failed, continuing without long-term memory:', err);
          return {
            context: '',
            synthesis: null,
            facts: null,
            groups: null,
            episodes: null,
            factCount: 0,
          };
        }),
      ]);
      if (!prepared) {
        res.status(404).json({ error: 'Thread not found' });
        return;
      }

      // Synthesis (prose summary) leads, followed by the structured fact block —
      // both are user-derived semantic memory and share the same framing.
      const contextBlock = [recalled.synthesis, recalled.context]
        .filter((part): part is string => Boolean(part && part.length > 0))
        .join('\n\n');

      const replyContent = await generateReply(
        prepared.messages,
        systemPrompt,
        recalled.episodes,
        contextBlock,
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
        },
        recallSummary: {
          episodeCount: recalled.episodes?.episodeCount ?? 0,
          factCount: recalled.factCount,
          hasContext: recalled.context.length > 0,
          hasSynthesis: Boolean(recalled.synthesis),
        },
        ...(verbose ? { recall: recalled } : {}),
      } satisfies WMChatResponse);
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

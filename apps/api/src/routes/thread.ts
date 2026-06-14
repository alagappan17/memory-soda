import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate.js';
import {
  createThread,
  getThread,
  updateThreadMetadata,
  endThread,
} from '../services/thread.service.js';
import { DEFAULT_EPISODIC_SETTINGS } from '../lib/project-settings.js';
import type { WMThreadSettings } from '@memory-soda/types';
import type { Thread } from '../services/thread.service.js';

const router = Router();

// ── Schemas ───────────────────────────────────────────────────────────────────

const episodicOverrideSchema = z.object({
  enabled: z.boolean().optional(),
  maxMessages: z.number().int().min(1).max(1000).optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  retryDelayMs: z.number().int().min(0).optional(),
  contextEpisodes: z.number().int().min(1).max(20).optional(),
  similarityWeight: z.number().min(0).max(1).optional(),
  recencyWeight: z.number().min(0).max(1).optional(),
});

const createThreadSchema = z.object({
  userId: z.string().min(1).optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  autoCompactThreshold: z.number().int().min(2).optional(),
  settings: z
    .object({
      episodic: episodicOverrideSchema.optional(),
    })
    .optional(),
});

const patchThreadSchema = z.object({
  metadata: z.record(z.unknown()),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function threadSettings(thread: Thread): WMThreadSettings {
  return {
    autoCompactThreshold: thread.autoCompactThreshold,
    episodic: thread.episodicSettings ?? DEFAULT_EPISODIC_SETTINGS,
  };
}

function serializeThread(thread: Thread) {
  return {
    threadId: thread.threadId,
    userId: thread.userId,
    tags: thread.tags,
    messageCount: thread.messageCount,
    metadata: thread.metadata,
    createdAt: thread.createdAt,
    lastActivityAt: thread.lastActivityAt,
    settings: threadSettings(thread),
    lastCompactedAt: thread.lastCompactedAt,
    lastCompactedSequence: thread.lastCompactedSequence,
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.post('/', validateBody(createThreadSchema), async (req, res) => {
  try {
    const { userId, tags, metadata, autoCompactThreshold, settings } =
      req.body as z.infer<typeof createThreadSchema>;
    const thread = await createThread(
      req.projectId!,
      userId,
      tags,
      metadata,
      autoCompactThreshold,
      settings?.episodic,
    );
    res.status(201).json({
      threadId: thread.threadId,
      userId: thread.userId,
      createdAt: thread.createdAt,
      settings: threadSettings(thread),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create thread' });
  }
});

router.get('/:threadId', async (req, res) => {
  try {
    const thread = await getThread(req.params.threadId, req.projectId!);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }
    res.json(serializeThread(thread));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to get thread' });
  }
});

router.patch(
  '/:threadId',
  validateBody(patchThreadSchema),
  async (req, res) => {
    try {
      const { metadata } = req.body as z.infer<typeof patchThreadSchema>;
      const thread = await updateThreadMetadata(
        req.params.threadId,
        req.projectId!,
        metadata,
      );
      if (!thread) {
        res.status(404).json({ error: 'Thread not found' });
        return;
      }
      res.json(serializeThread(thread));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to update thread' });
    }
  },
);

router.post('/:threadId/end', async (req, res) => {
  try {
    const result = await endThread(req.params.threadId, req.projectId!);
    if (!result) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }
    res.json({
      threadId: result.thread.threadId,
      episodeQueued: result.episodeQueued,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to end thread' });
  }
});

export default router;

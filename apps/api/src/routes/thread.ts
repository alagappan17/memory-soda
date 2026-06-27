import { Router } from 'express';
import { z } from 'zod';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { NotFoundError } from '../lib/errors.js';
import {
  createThread,
  getThread,
  updateThreadMetadata,
  endThread,
  listThreadsByProject,
} from '../services/thread.service.js';
import {
  DEFAULT_EPISODIC_SETTINGS,
  DEFAULT_SEMANTIC_SETTINGS,
  DEFAULT_WORKING_SETTINGS,
} from '../lib/project-settings.js';
import type { WMThreadSettings } from '@memory-soda/types';
import type { Thread } from '../services/thread.service.js';

const router = Router();

// ── Schemas ───────────────────────────────────────────────────────────────────

const episodicOverrideSchema = z.object({
  enabled: z.boolean().optional(),
  autoEpisodeIntervalMs: z.number().min(1_000).nullable().optional(),
  maxMessages: z.number().int().min(1).max(1000).optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  episodesInContext: z.number().int().min(1).max(20).optional(),
  recencyWeight: z.number().min(0).max(1).optional(),
});

const semanticOverrideSchema = z.object({
  enabled: z.boolean().optional(),
  factsInContext: z.number().int().min(1).max(50).optional(),
  entitySimilarityThreshold: z.number().min(0.5).max(1).optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  minUserFacts: z.number().int().min(1).max(10).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
});

const workingOverrideSchema = z.object({
  autoCompactThreshold: z.number().int().min(2).nullable().optional(),
  messageLimit: z.number().int().min(1).max(100).optional(),
});

const createThreadSchema = z.object({
  userId: z.string().min(1).optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  autoCompactThreshold: z.number().int().min(2).optional(),
  settings: z
    .object({
      episodic: episodicOverrideSchema.optional(),
      semantic: semanticOverrideSchema.optional(),
      working: workingOverrideSchema.optional(),
    })
    .optional(),
});

const patchThreadSchema = z.object({
  metadata: z.record(z.unknown()),
});

const listThreadsSchema = z.object({
  userId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().datetime().optional(),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function threadSettings(thread: Thread): WMThreadSettings {
  return {
    autoCompactThreshold: thread.autoCompactThreshold,
    episodic: thread.episodicSettings ?? DEFAULT_EPISODIC_SETTINGS,
    semantic: thread.semanticSettings ?? DEFAULT_SEMANTIC_SETTINGS,
    working: thread.workingSettings ?? DEFAULT_WORKING_SETTINGS,
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

router.get(
  '/',
  validateQuery(listThreadsSchema),
  asyncHandler(async (req, res) => {
    const { userId, limit, cursor } = req.query as unknown as z.infer<
      typeof listThreadsSchema
    >;
    const result = await listThreadsByProject(req.projectId!, {
      userId,
      limit,
      cursor,
    });
    res.json({
      threads: result.threads.map(serializeThread),
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
    });
  }),
);

router.post(
  '/',
  validateBody(createThreadSchema),
  asyncHandler(async (req, res) => {
    const { userId, tags, metadata, autoCompactThreshold, settings } =
      req.body as z.infer<typeof createThreadSchema>;
    const thread = await createThread(
      req.projectId!,
      userId,
      tags,
      metadata,
      autoCompactThreshold,
      settings,
    );
    res.status(201).json({
      threadId: thread.threadId,
      projectId: thread.projectId,
      userId: thread.userId,
      createdAt: thread.createdAt,
      settings: threadSettings(thread),
    });
  }),
);

router.get(
  '/:threadId',
  asyncHandler(async (req, res) => {
    const thread = await getThread(req.params.threadId, req.projectId!);
    if (!thread) throw new NotFoundError('Thread not found', 'THREAD_NOT_FOUND');
    res.json(serializeThread(thread));
  }),
);

router.patch(
  '/:threadId',
  validateBody(patchThreadSchema),
  asyncHandler(async (req, res) => {
    const { metadata } = req.body as z.infer<typeof patchThreadSchema>;
    const thread = await updateThreadMetadata(
      req.params.threadId,
      req.projectId!,
      metadata,
    );
    if (!thread) throw new NotFoundError('Thread not found', 'THREAD_NOT_FOUND');
    res.json(serializeThread(thread));
  }),
);

router.post(
  '/:threadId/end',
  asyncHandler(async (req, res) => {
    const result = await endThread(req.params.threadId, req.projectId!);
    if (!result) throw new NotFoundError('Thread not found', 'THREAD_NOT_FOUND');
    res.json({
      threadId: result.thread.threadId,
      episodeQueued: result.episodeQueued,
    });
  }),
);

export default router;

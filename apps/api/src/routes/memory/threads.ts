import { Router } from 'express';
import { z } from 'zod';
import { created, projectRoute } from '../../lib/route.js';
import { AppError } from '../../lib/errors.js';
import { datasetKey } from '../../lib/zod.js';
import {
  createThread,
  getThread,
  updateThreadMetadata,
  endThread,
  type Thread,
} from '../../services/thread.service.js';
import { getEffectiveEpisodicSettings } from '../../services/episodic-memory.service.js';
import type { WMThreadSettings } from '@memory-soda/types';

const router = Router();

const threadParams = z.object({ threadId: z.string().uuid() });

const episodicOverride = z.object({
  enabled: z.boolean().optional(),
  autoEpisodeIntervalMs: z.number().min(1_000).nullable().optional(),
  maxMessages: z.number().int().min(1).max(1000).optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  contextEpisodes: z.number().int().min(1).max(20).optional(),
  similarityWeight: z.number().min(0).max(1).optional(),
  recencyWeight: z.number().min(0).max(1).optional(),
});

const createBody = z.object({
  dataset: datasetKey.optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  autoCompactThreshold: z.number().int().min(2).optional(),
  settings: z.object({ episodic: episodicOverride.optional() }).optional(),
});

const patchBody = z.object({ metadata: z.record(z.unknown()) });

/**
 * Settings as the caller sees them: project defaults with this thread's
 * override applied. The stored override is a patch, so returning it raw would
 * report nothing for every key the caller never set.
 */
async function resolvedSettings(thread: Thread): Promise<WMThreadSettings> {
  return {
    autoCompactThreshold: thread.autoCompactThreshold,
    episodic: await getEffectiveEpisodicSettings(
      thread.projectId,
      thread.episodicSettings,
    ),
  };
}

async function serialize(thread: Thread) {
  return {
    threadId: thread.threadId,
    dataset: thread.dataset,
    tags: thread.tags,
    metadata: thread.metadata,
    createdAt: thread.createdAt,
    lastActivityAt: thread.lastActivityAt,
    settings: await resolvedSettings(thread),
    lastCompactedAt: thread.lastCompactedAt,
    lastCompactedSequence: thread.lastCompactedSequence,
  };
}

router.post(
  '/',
  projectRoute({ body: createBody }, async ({ body, projectId }) => {
    const thread = await createThread({
      projectId,
      dataset: body.dataset,
      tags: body.tags,
      metadata: body.metadata,
      autoCompactThreshold: body.autoCompactThreshold,
      episodicOverride: body.settings?.episodic,
    });
    return created({
      threadId: thread.threadId,
      projectId: thread.projectId,
      dataset: thread.dataset,
      createdAt: thread.createdAt,
      settings: await resolvedSettings(thread),
    });
  }),
);

router.get(
  '/:threadId',
  projectRoute({ params: threadParams }, async ({ params, projectId }) => {
    const thread = await getThread(params.threadId, projectId);
    if (!thread) throw AppError.notFound('Thread');
    return serialize(thread);
  }),
);

router.patch(
  '/:threadId',
  projectRoute(
    { params: threadParams, body: patchBody },
    async ({ params, body, projectId }) => {
      const thread = await updateThreadMetadata(
        params.threadId,
        projectId,
        body.metadata,
      );
      if (!thread) throw AppError.notFound('Thread');
      return serialize(thread);
    },
  ),
);

/**
 * Mark a natural break point. The thread stays writable — "end" queues episodic
 * extraction over whatever has been said since the last episode.
 */
router.post(
  '/:threadId/end',
  projectRoute({ params: threadParams }, async ({ params, projectId }) => {
    const result = await endThread(params.threadId, projectId);
    if (!result) throw AppError.notFound('Thread');
    return {
      threadId: result.thread.threadId,
      episodeQueued: result.episodeQueued,
    };
  }),
);

export default router;

import { Router } from 'express';
import { z } from 'zod';
import { validateQuery } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { NotFoundError, BadRequestError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import {
  listUserEpisodes,
  getEpisode,
  softDeleteEpisode,
  resetEpisodeForRetry,
  searchEpisodes,
  processEpisode,
  getProjectEpisodicSettings,
} from '../services/episodic-memory.service.js';

const router = Router();

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  before: z.string().datetime().optional(),
  status: z
    .enum(['pending', 'processing', 'completed', 'failed', 'archived'])
    .optional(),
});

const searchQuerySchema = z.object({
  q: z.string().min(1).max(1000),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

/**
 * @route GET /v1/memory/episodic/users/:userId/episodes
 * @description List episodes for a user. Only returns episodes for the authenticated API key.
 */
router.get(
  '/users/:userId/episodes',
  validateQuery(listQuerySchema),
  asyncHandler(async (req, res) => {
    const { limit, before, status } = req.query as unknown as z.infer<typeof listQuerySchema>;
    const result = await listUserEpisodes(req.params.userId, req.projectId!, {
      limit,
      before,
      status,
    });
    res.json(result);
  }),
);

/**
 * @route GET /v1/memory/episodic/users/:userId/episodes/search
 * @description Semantic search over episodes for a user.
 */
router.get(
  '/users/:userId/episodes/search',
  validateQuery(searchQuerySchema),
  asyncHandler(async (req, res) => {
    const { q, limit } = req.query as unknown as z.infer<typeof searchQuerySchema>;
    const settings = await getProjectEpisodicSettings(req.projectId!);
    const episodes = await searchEpisodes(
      req.params.userId,
      req.projectId!,
      q,
      limit,
      settings.recencyWeight,
    );
    res.json({ episodes });
  }),
);

/**
 * @route GET /v1/memory/episodic/episodes/:episodeId
 * @description Get a single episode by ID.
 */
router.get(
  '/episodes/:episodeId',
  asyncHandler(async (req, res) => {
    const episode = await getEpisode(req.params.episodeId, req.projectId!);
    if (!episode) throw new NotFoundError('Episode not found', 'EPISODE_NOT_FOUND');
    res.json({ episode });
  }),
);

/**
 * @route DELETE /v1/memory/episodic/episodes/:episodeId
 * @description Soft delete an episode. Clears summary, key_learnings, and embedding.
 */
router.delete(
  '/episodes/:episodeId',
  asyncHandler(async (req, res) => {
    const existing = await getEpisode(req.params.episodeId, req.projectId!);
    if (!existing) throw new NotFoundError('Episode not found', 'EPISODE_NOT_FOUND');
    if (existing.status === 'archived') {
      throw new BadRequestError('Episode is already archived');
    }
    await softDeleteEpisode(req.params.episodeId, req.projectId!);
    res.json({ episodeId: req.params.episodeId, deleted: true });
  }),
);

/**
 * @route POST /v1/memory/episodic/episodes/:episodeId/retry
 * @description Re-trigger extraction for a failed episode.
 */
router.post(
  '/episodes/:episodeId/retry',
  asyncHandler(async (req, res) => {
    const existing = await getEpisode(req.params.episodeId, req.projectId!);
    if (!existing) throw new NotFoundError('Episode not found', 'EPISODE_NOT_FOUND');
    if (existing.status !== 'failed') {
      throw new BadRequestError('Only failed episodes can be retried');
    }
    const updated = await resetEpisodeForRetry(
      req.params.episodeId,
      req.projectId!,
    );
    if (updated) {
      processEpisode(updated.episodeId).catch((err) => {
        logger.error({ err }, '[episodic] retry processEpisode failed');
      });
    }
    res.json({ episodeId: req.params.episodeId, status: 'pending' });
  }),
);

export default router;

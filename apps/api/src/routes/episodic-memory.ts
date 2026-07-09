import { Router } from 'express';
import { z } from 'zod';
import { validateQuery } from '../middleware/validate.js';
import {
  listUserEpisodes,
  getEpisode,
  softDeleteEpisode,
  resetEpisodeForRetry,
  searchEpisodes,
  processEpisode,
} from '../services/episodic-memory.service.js';

const router = Router();

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  before: z.string().datetime().optional(),
  status: z
    .enum(['pending', 'processing', 'completed', 'failed'])
    .default('completed'),
});

const searchQuerySchema = z.object({
  q: z.string().min(1).max(1000),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

/**
 * @route GET /v1/memory/episodic/datasets/:dataset/episodes
 * @description List episodes for a user. Only returns episodes for the authenticated API key.
 */
router.get(
  '/datasets/:dataset/episodes',
  validateQuery(listQuerySchema),
  async (req, res) => {
    try {
      const { limit, before, status } = req.query as unknown as z.infer<typeof listQuerySchema>;
      const result = await listUserEpisodes(req.params.dataset, req.projectId!, {
        limit,
        before,
        status,
      });
      res.json(result);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to list episodes' });
    }
  },
);

/**
 * @route GET /v1/memory/episodic/datasets/:dataset/episodes/search
 * @description Semantic search over episodes for a user.
 */
router.get(
  '/datasets/:dataset/episodes/search',
  validateQuery(searchQuerySchema),
  async (req, res) => {
    try {
      const { q, limit } = req.query as unknown as z.infer<typeof searchQuerySchema>;
      const episodes = await searchEpisodes(
        req.params.dataset,
        req.projectId!,
        q,
        limit,
      );
      res.json({ episodes });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to search episodes' });
    }
  },
);

/**
 * @route GET /v1/memory/episodic/episodes/:episodeId
 * @description Get a single episode by ID.
 */
router.get('/episodes/:episodeId', async (req, res) => {
  try {
    const episode = await getEpisode(req.params.episodeId, req.projectId!);
    if (!episode) {
      res.status(404).json({ error: 'Episode not found' });
      return;
    }
    res.json({ episode });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to get episode' });
  }
});

/**
 * @route DELETE /v1/memory/episodic/episodes/:episodeId
 * @description Soft delete an episode. Clears summary, key_learnings, and embedding.
 */
router.delete('/episodes/:episodeId', async (req, res) => {
  try {
    const existing = await getEpisode(req.params.episodeId, req.projectId!);
    if (!existing) {
      res.status(404).json({ error: 'Episode not found' });
      return;
    }
    if (existing.status === 'archived') {
      res.status(400).json({ error: 'Episode is already archived' });
      return;
    }
    await softDeleteEpisode(req.params.episodeId, req.projectId!);
    res.json({ episodeId: req.params.episodeId, deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete episode' });
  }
});

/**
 * @route POST /v1/memory/episodic/episodes/:episodeId/retry
 * @description Re-trigger extraction for a failed episode.
 */
router.post('/episodes/:episodeId/retry', async (req, res) => {
  try {
    const existing = await getEpisode(req.params.episodeId, req.projectId!);
    if (!existing) {
      res.status(404).json({ error: 'Episode not found' });
      return;
    }
    if (existing.status !== 'failed') {
      res.status(400).json({ error: 'Only failed episodes can be retried' });
      return;
    }
    const updated = await resetEpisodeForRetry(
      req.params.episodeId,
      req.projectId!,
    );
    if (updated) {
      processEpisode(updated.episodeId).catch((err) => {
        console.error('[episodic] retry processEpisode failed:', err);
      });
    }
    res.json({ episodeId: req.params.episodeId, status: 'pending' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to retry episode' });
  }
});

export default router;

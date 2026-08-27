import { Router } from 'express';
import { z } from 'zod';
import { projectRoute } from '../../lib/route.js';
import { AppError } from '../../lib/errors.js';
import {
  listUserEpisodes,
  getEpisode,
  softDeleteEpisode,
  retryEpisode,
  searchEpisodes,
} from '../../services/episodic-memory.service.js';

const router = Router();

const datasetParams = z.object({ dataset: z.string().min(1) });
const episodeParams = z.object({ episodeId: z.string().uuid() });

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
  before: z.string().datetime().optional(),
  status: z
    .enum(['all', 'pending', 'processing', 'completed', 'failed', 'archived'])
    .default('completed'),
});

const searchQuery = z.object({
  q: z.string().min(1).max(1000),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

/** List a dataset's episodes, newest first. */
router.get(
  '/datasets/:dataset/episodes',
  projectRoute(
    { params: datasetParams, query: listQuery },
    ({ params, query, projectId }) =>
      listUserEpisodes(params.dataset, projectId, query),
  ),
);

/** Semantic search over a dataset's episodes. */
router.get(
  '/datasets/:dataset/episodes/search',
  projectRoute(
    { params: datasetParams, query: searchQuery },
    async ({ params, query, projectId }) => ({
      episodes: await searchEpisodes(
        params.dataset,
        projectId,
        query.q,
        query.limit,
      ),
    }),
  ),
);

router.get(
  '/episodes/:episodeId',
  projectRoute({ params: episodeParams }, async ({ params, projectId }) => {
    const episode = await getEpisode(params.episodeId, projectId);
    if (!episode) throw AppError.notFound('Episode');
    return { episode };
  }),
);

/** Archive an episode. Its extracted facts are left in place. */
router.delete(
  '/episodes/:episodeId',
  projectRoute({ params: episodeParams }, async ({ params, projectId }) => {
    const existing = await getEpisode(params.episodeId, projectId);
    if (!existing) throw AppError.notFound('Episode');
    if (existing.status === 'archived') {
      throw AppError.badRequest('Episode is already archived');
    }
    await softDeleteEpisode(params.episodeId, projectId);
    return { episodeId: params.episodeId, deleted: true };
  }),
);

/** Re-run extraction for a failed episode, spending one retry. */
router.post(
  '/episodes/:episodeId/retry',
  projectRoute({ params: episodeParams }, async ({ params, projectId }) => {
    const outcome = await retryEpisode(params.episodeId, projectId);
    switch (outcome) {
      case 'queued':
        return { episodeId: params.episodeId, status: 'pending' };
      case 'not_found':
        throw AppError.notFound('Episode');
      case 'not_failed':
        throw AppError.badRequest('Only failed episodes can be retried');
      case 'retries_exhausted':
        throw AppError.badRequest('Episode has used its full retry budget');
    }
  }),
);

export default router;

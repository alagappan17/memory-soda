import { Router } from 'express';
import { z } from 'zod';
import { projectRoute } from '../../lib/route.js';
import { datasetKey } from '../../lib/zod.js';
import { recall } from '../../services/recall.service.js';
import {
  deleteDataset,
  exportDataset,
} from '../../services/dataset.service.js';

const router = Router();

const recallBody = z.object({
  dataset: datasetKey,
  query: z.string().max(2000).optional(),
  include: z.array(z.enum(['episodes', 'synthesis', 'raw'])).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  asOf: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
});

const datasetParams = z.object({ dataset: datasetKey });

/**
 * Retrieve long-term memory for a dataset — facts always, episodes and a prose
 * synthesis on request. Thread-free: usable from any request that knows the
 * dataset key.
 */
router.post(
  '/',
  projectRoute({ body: recallBody }, ({ body, projectId }) =>
    recall(projectId, body),
  ),
);

/**
 * Everything stored about one dataset, for export or inspection.
 *
 * A self-hosted memory layer holds personal data, so the people it holds it
 * about need a way to see all of it and a way to have it deleted. Both live
 * here rather than being reconstructed by paginating three other endpoints.
 */
router.get(
  '/datasets/:dataset/export',
  projectRoute({ params: datasetParams }, ({ params, projectId }) =>
    exportDataset(params.dataset, projectId),
  ),
);

/** Forget a dataset: every thread, message, episode, fact and entity. */
router.delete(
  '/datasets/:dataset',
  projectRoute({ params: datasetParams }, ({ params, projectId }) =>
    deleteDataset(params.dataset, projectId),
  ),
);

export default router;

import { Router } from 'express';
import { z } from 'zod';
import { projectRoute } from '../../lib/route.js';
import { AppError } from '../../lib/errors.js';
import {
  listDatasets,
  listThreads,
  getThreadWithMessages,
} from '../../services/dashboard.service.js';
import { getThreadEpisodes } from '../../services/episodic-memory.service.js';

/**
 * Read-only views that exist only for the dashboard.
 *
 * Unlike everything under the memory router, these have no SDK counterpart,
 * they are cross-dataset admin listings ("who does this project know about",
 * "show me that conversation"), not memory operations an agent would perform.
 */
const router = Router();

const threadParams = z.object({ threadId: z.string().uuid() });

const pageQuery = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Every dataset in the project, with thread and live-fact counts. */
router.get(
  '/datasets',
  projectRoute({ query: pageQuery }, ({ query, projectId }) =>
    listDatasets({ projectId, ...query }),
  ),
);

router.get(
  '/threads',
  projectRoute(
    { query: pageQuery.extend({ dataset: z.string().optional() }) },
    ({ query, projectId }) => listThreads({ projectId, ...query }),
  ),
);

router.get(
  '/threads/:threadId/messages',
  projectRoute({ params: threadParams }, async ({ params, projectId }) => {
    const result = await getThreadWithMessages(params.threadId, projectId);
    if (!result) throw AppError.notFound('Thread');
    return result;
  }),
);

router.get(
  '/threads/:threadId/episodes',
  projectRoute({ params: threadParams }, async ({ params, projectId }) => ({
    episodes: await getThreadEpisodes(params.threadId, projectId),
  })),
);

export default router;

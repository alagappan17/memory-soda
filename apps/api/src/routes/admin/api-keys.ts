import { Router } from 'express';
import { z } from 'zod';
import { created, noContent, route } from '../../lib/route.js';
import { AppError } from '../../lib/errors.js';
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
} from '../../services/api-key.service.js';
import { projectExists } from '../../services/project.service.js';

const router = Router();

const listQuery = z.object({ projectId: z.string().uuid().optional() });

const createBody = z.object({
  name: z.string().min(1).max(100),
  projectId: z.string().uuid().optional(),
});

/**
 * List API keys, optionally for one project. Key values are never returned —
 * only the preview stored alongside the hash.
 */
router.get(
  '/',
  route({ query: listQuery }, async ({ query }) => ({
    apiKeys: await listApiKeys(query.projectId),
  })),
);

/**
 * Mint a key. The plaintext is in this response and nowhere else, ever again.
 */
router.post(
  '/',
  route({ body: createBody }, async ({ body }) => {
    // Validated rather than trusted: an unchecked projectId would mint a key
    // pointing at a project that does not exist, which fails later as a 500 on
    // the first request that uses it.
    if (body.projectId && !(await projectExists(body.projectId))) {
      throw AppError.notFound('Project');
    }
    return created(await createApiKey(body.name, body.projectId));
  }),
);

router.delete(
  '/:id',
  route({ params: z.object({ id: z.string().uuid() }) }, async ({ params }) => {
    const revoked = await revokeApiKey(params.id);
    if (!revoked) throw AppError.notFound('API key');
    return noContent();
  }),
);

export default router;

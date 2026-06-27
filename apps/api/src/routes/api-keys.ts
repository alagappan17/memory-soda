import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { createApiKey, listApiKeys, revokeApiKey } from '../services/api-key.service.js';

const router = Router();

const createBodySchema = z.object({
  name: z.string().min(1).max(100),
  projectId: z.string().uuid().optional(),
});

/**
 * @route GET /dashboard/api-keys
 * @description List all API keys (name, preview, projectId). Full key values are never returned.
 * @returns {{ apiKeys: ApiKey[] }}
 */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const keys = await listApiKeys();
    res.json({ apiKeys: keys });
  }),
);

/**
 * @route POST /dashboard/api-keys
 * @description Create a new API key. The full key is returned once and never stored in plaintext.
 * @body {{ name: string, projectId?: string }}
 * @returns {{ key: string, keyId: string, preview: string, name: string, projectId?: string, createdAt: string }}
 */
router.post(
  '/',
  validateBody(createBodySchema),
  asyncHandler(async (req, res) => {
    const { name, projectId } = req.body as z.infer<typeof createBodySchema>;
    const result = await createApiKey(name, projectId);
    res.status(201).json(result);
  }),
);

/**
 * @route DELETE /dashboard/api-keys/:id
 * @description Permanently revoke an API key. Any in-flight requests using the key will fail immediately.
 * @param {string} id - The key ID (not the key value).
 * @returns 204 No Content
 */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await revokeApiKey(req.params['id']!);
    res.status(204).send();
  }),
);

export default router;

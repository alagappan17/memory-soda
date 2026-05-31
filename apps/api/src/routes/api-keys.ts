import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate.js';
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
router.get('/', async (_req, res) => {
  try {
    const keys = await listApiKeys();
    res.json({ apiKeys: keys });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list API keys' });
  }
});

/**
 * @route POST /dashboard/api-keys
 * @description Create a new API key. The full key is returned once and never stored in plaintext.
 * @body {{ name: string, projectId?: string }}
 * @returns {{ key: string, keyId: string, preview: string, name: string, projectId?: string, createdAt: string }}
 */
router.post('/', validateBody(createBodySchema), async (req, res) => {
  try {
    const { name, projectId } = req.body as z.infer<typeof createBodySchema>;
    const result = await createApiKey(name, projectId);
    res.status(201).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

/**
 * @route DELETE /dashboard/api-keys/:id
 * @description Permanently revoke an API key. Any in-flight requests using the key will fail immediately.
 * @param {string} id - The key ID (not the key value).
 * @returns 204 No Content
 */
router.delete('/:id', async (req, res) => {
  try {
    await revokeApiKey(req.params['id']!);
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to revoke API key' });
  }
});

export default router;

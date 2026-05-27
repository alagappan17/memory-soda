import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate.js';
import { createApiKey, listApiKeys, revokeApiKey } from '../services/api-key.service.js';

const router = Router();

const createBodySchema = z.object({
  name: z.string().min(1).max(100),
  projectId: z.string().uuid().optional(),
});

router.get('/', async (_req, res) => {
  try {
    const keys = await listApiKeys();
    res.json({ apiKeys: keys });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list API keys' });
  }
});

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

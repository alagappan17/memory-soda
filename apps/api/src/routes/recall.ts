import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate.js';
import { recall } from '../services/recall.service.js';

const router = Router();

const recallSchema = z.object({
  dataset: z.string().min(1).max(256),
  query: z.string().max(2000).optional(),
  include: z.array(z.enum(['episodes', 'synthesis', 'raw'])).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  asOf: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
});

/**
 * @route POST /v1/memory/recall
 * @description Retrieve long-term memory (facts, optionally episodes and a
 * prose synthesis) for a dataset. Thread-free: usable from any request that
 * knows the dataset key.
 */
router.post('/', validateBody(recallSchema), async (req, res) => {
  try {
    const body = req.body as z.infer<typeof recallSchema>;
    const result = await recall(req.projectId!, body);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to recall memory' });
  }
});

export default router;

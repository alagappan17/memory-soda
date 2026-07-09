import { Router } from 'express';
import { z } from 'zod';
import { validateQuery, boolish } from '../middleware/validate.js';
import {
  querySemanticFacts,
  listEntities,
  listEntityFacts,
  softDeleteFact,
} from '../services/semantic-memory.service.js';

const router = Router();

const factsQuerySchema = z.object({
  q: z.string().max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  includeInvalidated: boolish,
  /** Point-in-time filter: facts that were true at this instant. Overrides includeInvalidated. */
  asOf: z.coerce.date().optional(),
  /** Provenance filter: only facts extracted from this episode. */
  episodeId: z.string().uuid().optional(),
});

/**
 * @route GET /v1/memory/semantic/datasets/:dataset/facts
 * @description List (or keyword-search via ?q=) a user's facts.
 */
router.get(
  '/datasets/:dataset/facts',
  validateQuery(factsQuerySchema),
  async (req, res) => {
    try {
      const { q, limit, includeInvalidated, asOf, episodeId } =
        req.query as unknown as z.infer<typeof factsQuerySchema>;
      const result = await querySemanticFacts(
        req.params.dataset,
        req.projectId!,
        { q, limit, includeInvalidated, asOf, episodeId },
      );
      res.json(result);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to list facts' });
    }
  },
);

/**
 * @route DELETE /v1/memory/semantic/datasets/:dataset/facts/:factId
 * @description Soft-delete a fact by stamping invalidAt.
 */
router.delete('/datasets/:dataset/facts/:factId', async (req, res) => {
  try {
    const deleted = await softDeleteFact(
      req.params.dataset,
      req.projectId!,
      req.params.factId,
    );
    if (!deleted) {
      res.status(404).json({ error: 'Fact not found' });
      return;
    }
    res.json({ factId: req.params.factId, deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete fact' });
  }
});

/**
 * @route GET /v1/memory/semantic/datasets/:dataset/entities
 * @description List resolved entities for a user.
 */
router.get('/datasets/:dataset/entities', async (req, res) => {
  try {
    const entities = await listEntities(req.params.dataset, req.projectId!);
    res.json({ entities });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list entities' });
  }
});

/**
 * @route GET /v1/memory/semantic/datasets/:dataset/entities/:name/facts
 * @description List live facts anchored to a named entity.
 */
router.get('/datasets/:dataset/entities/:name/facts', async (req, res) => {
  try {
    const facts = await listEntityFacts(
      req.params.dataset,
      req.projectId!,
      req.params.name.toLowerCase(),
    );
    res.json({ facts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list entity facts' });
  }
});

export default router;

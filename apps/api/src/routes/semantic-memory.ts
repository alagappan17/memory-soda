import { Router } from 'express';
import { z } from 'zod';
import { validateQuery } from '../middleware/validate.js';
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
  // z.coerce.boolean() treats any non-empty string (incl. "false") as true, so
  // parse boolish query strings explicitly.
  includeInvalidated: z.preprocess(
    (v) => v === true || v === 'true' || v === '1',
    z.boolean(),
  ),
});

/**
 * @route GET /v1/memory/semantic/users/:userId/facts
 * @description List (or keyword-search via ?q=) a user's facts.
 */
router.get(
  '/users/:userId/facts',
  validateQuery(factsQuerySchema),
  async (req, res) => {
    try {
      const { q, limit, includeInvalidated } = req.query as unknown as z.infer<
        typeof factsQuerySchema
      >;
      const result = await querySemanticFacts(
        req.params.userId,
        req.projectId!,
        { q, limit, includeInvalidated },
      );
      res.json(result);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to list facts' });
    }
  },
);

/**
 * @route DELETE /v1/memory/semantic/users/:userId/facts/:factId
 * @description Soft-delete a fact by stamping invalidAt.
 */
router.delete('/users/:userId/facts/:factId', async (req, res) => {
  try {
    const deleted = await softDeleteFact(
      req.params.userId,
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
 * @route GET /v1/memory/semantic/users/:userId/entities
 * @description List resolved entities for a user.
 */
router.get('/users/:userId/entities', async (req, res) => {
  try {
    const entities = await listEntities(req.params.userId, req.projectId!);
    res.json({ entities });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list entities' });
  }
});

/**
 * @route GET /v1/memory/semantic/users/:userId/entities/:name/facts
 * @description List live facts anchored to a named entity.
 */
router.get('/users/:userId/entities/:name/facts', async (req, res) => {
  try {
    const facts = await listEntityFacts(
      req.params.userId,
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

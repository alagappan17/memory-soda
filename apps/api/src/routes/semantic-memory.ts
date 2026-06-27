import { Router } from 'express';
import { z } from 'zod';
import { validateQuery } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { NotFoundError } from '../lib/errors.js';
import {
  querySemanticFacts,
  querySemanticRelationships,
  listSemanticEntities,
  listEntityFacts,
  softDeleteFact,
} from '../services/semantic-memory.service.js';

const router = Router();

const factsQuerySchema = z.object({
  q: z.string().min(1).max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  includeInvalidated: z.coerce.boolean().default(false),
});

router.get(
  '/users/:userId/facts',
  validateQuery(factsQuerySchema),
  asyncHandler(async (req, res) => {
    const { q, limit, includeInvalidated } = req.query as unknown as z.infer<
      typeof factsQuerySchema
    >;
    const result = await querySemanticFacts(
      req.params.userId,
      req.projectId!,
      q,
      limit,
      includeInvalidated,
    );
    res.json(result);
  }),
);

router.get(
  '/users/:userId/entities',
  asyncHandler(async (req, res) => {
    const entities = await listSemanticEntities(req.params.userId, req.projectId!);
    res.json({ entities });
  }),
);

router.get(
  '/users/:userId/entities/:name/facts',
  asyncHandler(async (req, res) => {
    const facts = await listEntityFacts(
      req.params.userId,
      req.projectId!,
      req.params.name,
    );
    res.json({ facts });
  }),
);

const relationshipsQuerySchema = z.object({
  q: z.string().min(1).max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

router.get(
  '/users/:userId/relationships',
  validateQuery(relationshipsQuerySchema),
  asyncHandler(async (req, res) => {
    const { q, limit } = req.query as unknown as z.infer<
      typeof relationshipsQuerySchema
    >;
    const result = await querySemanticRelationships(
      req.params.userId,
      req.projectId!,
      q,
      limit,
    );
    res.json(result);
  }),
);

router.delete(
  '/facts/:factId',
  asyncHandler(async (req, res) => {
    const found = await softDeleteFact(req.params.factId, req.projectId!);
    if (!found) throw new NotFoundError('Fact not found or already invalidated', 'FACT_NOT_FOUND');
    res.json({ ok: true });
  }),
);

export default router;

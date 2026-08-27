import { Router } from 'express';
import { z } from 'zod';
import { projectRoute } from '../../lib/route.js';
import { AppError } from '../../lib/errors.js';
import {
  querySemanticFacts,
  listEntities,
  listEntityFacts,
  softDeleteFact,
} from '../../services/semantic-memory.service.js';
import { boolish } from '../../lib/zod.js';

const router = Router();

const datasetParams = z.object({ dataset: z.string().min(1) });

const factsQuery = z.object({
  q: z.string().max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  includeInvalidated: boolish,
  /** Point-in-time filter: facts true at this instant. Overrides includeInvalidated. */
  asOf: z.coerce.date().optional(),
  /** Provenance filter: only facts extracted from this episode. */
  episodeId: z.string().uuid().optional(),
});

/** List (or keyword-search via `?q=`) a dataset's facts. */
router.get(
  '/datasets/:dataset/facts',
  projectRoute(
    { params: datasetParams, query: factsQuery },
    ({ params, query, projectId }) =>
      querySemanticFacts(params.dataset, projectId, query),
  ),
);

/** Soft-delete a fact by stamping invalidAt. */
router.delete(
  '/datasets/:dataset/facts/:factId',
  projectRoute(
    {
      params: datasetParams.extend({ factId: z.string().uuid() }),
    },
    async ({ params, projectId }) => {
      const deleted = await softDeleteFact(
        params.dataset,
        projectId,
        params.factId,
      );
      if (!deleted) throw AppError.notFound('Fact');
      return { factId: params.factId, deleted: true };
    },
  ),
);

/** List the resolved entities for a dataset. */
router.get(
  '/datasets/:dataset/entities',
  projectRoute({ params: datasetParams }, async ({ params, projectId }) => ({
    entities: await listEntities(params.dataset, projectId),
  })),
);

/** List the live facts anchored to a named entity. */
router.get(
  '/datasets/:dataset/entities/:name/facts',
  projectRoute(
    { params: datasetParams.extend({ name: z.string().min(1) }) },
    async ({ params, projectId }) => ({
      // Entity names are stored lowercased by extraction, so the lookup is too.
      facts: await listEntityFacts(
        params.dataset,
        projectId,
        params.name.toLowerCase(),
      ),
    }),
  ),
);

export default router;

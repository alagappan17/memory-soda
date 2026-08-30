import { Router } from 'express';
import { z } from 'zod';
import { projectRoute } from '../../lib/route.js';
import {
  getUsageSummary,
  listUsageLogs,
} from '../../services/usage.service.js';

/**
 * Usage log views for the dashboard. Dashboard-only: an operator's cost and
 * latency picture, not a memory operation an agent performs, so no SDK
 * counterpart.
 */
const router = Router();

const DAY = 24 * 60 * 60 * 1000;

const filterQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  dataset: z.string().optional(),
  source: z.enum(['api', 'dashboard', 'worker']).optional(),
  operation: z.string().optional(),
  stage: z.string().optional(),
  kind: z.enum(['llm', 'embed', 'span']).optional(),
  service: z.string().optional(),
  model: z.string().optional(),
  apiKeyId: z.string().uuid().optional(),
});

/** Default window: the last 30 days. */
const withWindow = <T extends { from?: Date; to?: Date }>(q: T) => {
  const to = q.to ?? new Date();
  return { ...q, to, from: q.from ?? new Date(to.getTime() - 30 * DAY) };
};

router.get(
  '/',
  projectRoute(
    {
      query: filterQuery.extend({
        bucket: z.enum(['day', 'week', 'month']).default('day'),
      }),
    },
    ({ query, projectId }) => {
      const { bucket, ...rest } = query;
      return getUsageSummary({ projectId, ...withWindow(rest) }, bucket);
    },
  ),
);

router.get(
  '/logs',
  projectRoute(
    {
      query: filterQuery.extend({
        limit: z.coerce.number().int().min(1).max(200).default(50),
        cursor: z.coerce.date().optional(),
      }),
    },
    ({ query, projectId }) => {
      const { limit, cursor, ...rest } = query;
      return listUsageLogs(
        { projectId, ...withWindow(rest) },
        { limit, cursor },
      );
    },
  ),
);

export default router;

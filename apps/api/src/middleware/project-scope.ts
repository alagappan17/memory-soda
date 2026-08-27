import type { RequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';

const projectQuery = z.object({ projectId: z.string().uuid() });

/**
 * Resolve the project from `?projectId=` for the dashboard mount of the memory
 * router.
 *
 * An API key names its own project; a dashboard session does not, because one
 * operator can see several. This is the only difference between the two mounts,
 * so it is the only thing that needs its own middleware.
 */
export const projectFromQuery: RequestHandler = (req, res, next) => {
  const parsed = projectQuery.safeParse(req.query);
  if (!parsed.success) {
    next(AppError.badRequest('A projectId query parameter is required'));
    return;
  }
  res.locals.projectId = parsed.data.projectId;
  next();
};

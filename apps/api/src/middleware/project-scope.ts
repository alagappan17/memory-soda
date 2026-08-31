import type { RequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';

const projectId = z.string().uuid();

/**
 * Resolve the project from the `/dashboard/projects/:projectId/*` mount path.
 *
 * An API key names its own project; a dashboard session does not, because one
 * operator can see several. This is the only difference between the two mounts
 * of the memory router, so it is the only thing that needs its own middleware.
 */
export const projectScope: RequestHandler = (req, res, next) => {
  const parsed = projectId.safeParse(req.params['projectId']);
  if (!parsed.success) {
    next(AppError.badRequest('A valid projectId is required'));
    return;
  }
  res.locals.projectId = parsed.data;
  next();
};

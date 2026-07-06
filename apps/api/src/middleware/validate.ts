import type { Request, Response, NextFunction } from 'express';
import { z, type ZodSchema } from 'zod';

/**
 * Parse a boolish query-string value. `z.coerce.boolean()` treats any non-empty
 * string (including "false") as true, so only "true"/"1" count as true here.
 */
export const boolish = z.preprocess(
  (v) => v === true || v === 'true' || v === '1',
  z.boolean(),
);

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: 'Validation error', issues: result.error.issues });
      return;
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      res.status(400).json({ error: 'Validation error', issues: result.error.issues });
      return;
    }
    req.query = result.data as typeof req.query;
    next();
  };
}

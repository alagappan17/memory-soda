import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema } from 'zod';

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

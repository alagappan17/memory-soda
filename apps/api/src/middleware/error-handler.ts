import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../lib/errors.js';

function requestId(req: Request): string | undefined {
  return (req as Request & { id?: string }).id;
}

/**
 * Terminal handler for unmatched routes — returns JSON instead of Express's
 * default HTML 404. Must be mounted after all routers.
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: 'Not found',
    code: 'NOT_FOUND',
    requestId: requestId(req),
  });
}

/**
 * Central error handler. Maps AppError subclasses to their status + machine
 * code; everything else becomes a 500 with the message hidden. The full error
 * (including stack) is logged with the request id for correlation.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const log = (req as Request & { log?: { error: (o: unknown, m?: string) => void } }).log;

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      log?.error({ err, code: err.code }, 'request failed');
    }
    res.status(err.statusCode).json({
      error: err.expose ? err.message : 'Internal error',
      code: err.code,
      requestId: requestId(req),
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
    return;
  }

  log?.error({ err }, 'unhandled error');
  res.status(500).json({
    error: 'Internal error',
    code: 'INTERNAL',
    requestId: requestId(req),
  });
}

/**
 * Machine-readable error codes returned to clients in the `code` field.
 * Stable strings — treat as a public contract for SDK consumers.
 */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'THREAD_NOT_FOUND'
  | 'PROJECT_NOT_FOUND'
  | 'EPISODE_NOT_FOUND'
  | 'FACT_NOT_FOUND'
  | 'CONFLICT'
  | 'UNPROCESSABLE'
  | 'INTERNAL'
  | 'SERVICE_UNAVAILABLE';

/**
 * Base class for all operational (expected) errors. The central error handler
 * maps these to their `statusCode` and serializes `{ error, code, details }`.
 * `expose` marks whether `message` is safe to send to the client.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly expose: boolean;
  readonly details?: unknown;

  constructor(
    statusCode: number,
    code: ErrorCode,
    message: string,
    opts: { expose?: boolean; details?: unknown } = {},
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.expose = opts.expose ?? true;
    this.details = opts.details;
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', code: ErrorCode = 'BAD_REQUEST', details?: unknown) {
    super(400, code, message, { details });
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation error', details?: unknown) {
    super(400, 'VALIDATION_ERROR', message, { details });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', code: ErrorCode = 'UNAUTHORIZED') {
    super(401, code, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, 'FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found', code: ErrorCode = 'NOT_FOUND') {
    super(404, code, message);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', code: ErrorCode = 'CONFLICT') {
    super(409, code, message);
  }
}

export class UnprocessableEntityError extends AppError {
  constructor(message = 'Unprocessable entity', details?: unknown) {
    super(422, 'UNPROCESSABLE', message, { details });
  }
}

export class InternalError extends AppError {
  constructor(message = 'Internal error') {
    super(500, 'INTERNAL', message, { expose: false });
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service unavailable') {
    super(503, 'SERVICE_UNAVAILABLE', message);
  }
}

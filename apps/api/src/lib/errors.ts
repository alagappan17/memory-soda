/**
 * The one way a service reports a failure the caller should see.
 *
 * Services throw; the error middleware in `main.ts` turns these into a
 * response. Anything else that reaches the middleware is a bug and becomes a
 * 500 with its detail kept out of the response body.
 */
export class AppError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError(400, message, details);
  }

  static unauthorized(message = 'Unauthorized'): AppError {
    return new AppError(401, message);
  }

  static notFound(what: string): AppError {
    return new AppError(404, `${what} not found`);
  }

  static conflict(message: string): AppError {
    return new AppError(409, message);
  }
}

/** Narrow an unknown caught value to an AppError. */
export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export class MemorySodaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ApiError extends MemorySodaError {
  public readonly status: number;
  public readonly body: unknown;
  /** Machine-readable error code from the API taxonomy (e.g. `THREAD_NOT_FOUND`). */
  public readonly code?: string;
  /** Structured error details (e.g. Zod validation issues). */
  public readonly details?: unknown;
  /** Server request id for log correlation. */
  public readonly requestId?: string;

  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.status = status;
    this.body = body;
    if (body && typeof body === 'object') {
      const b = body as {
        code?: string;
        details?: unknown;
        requestId?: string;
        error?: string;
      };
      this.code = b.code;
      this.details = b.details;
      this.requestId = b.requestId;
      if (typeof b.error === 'string') this.message = b.error;
    }
  }
}

export class NetworkError extends MemorySodaError {
  public readonly networkCause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.networkCause = cause;
  }
}

export class AuthError extends MemorySodaError {
  constructor(message = 'Invalid or missing API key') {
    super(message);
  }
}

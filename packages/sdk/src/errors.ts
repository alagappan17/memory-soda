export class MemorySodaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ApiError extends MemorySodaError {
  public readonly status: number;
  public readonly body: unknown;

  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.status = status;
    this.body = body;
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

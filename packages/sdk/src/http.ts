import { ApiError, AuthError, NetworkError } from './errors.js';

export interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** Overrides the client's default for this call. */
  timeout?: number;
}

/** Called before every request. Useful for logging and request inspection. */
export type OnRequest = (info: {
  method: string;
  path: string;
  body?: unknown;
}) => void;

/** Called after every request, including failures. */
export type OnResponse = (info: {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  body: unknown;
}) => void;

export interface HttpOptions {
  baseUrl: string;
  apiKey: string;
  /** Per-request timeout in milliseconds. Default 60s. */
  timeout?: number;
  /** How many times to retry a retryable failure. Default 2. */
  maxRetries?: number;
  onRequest?: OnRequest;
  onResponse?: OnResponse;
}

/** Retried: transient by nature. A 4xx is the caller's problem and is not. */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The transport every client method goes through.
 *
 * One object holds the base URL, credential, timeout and hooks, so the sub
 * clients take a single constructor argument instead of threading four.
 */
export class Http {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly onRequest: OnRequest | undefined;
  private readonly onResponse: OnResponse | undefined;

  constructor(options: HttpOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.timeout = options.timeout ?? 60_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.onRequest = options.onRequest;
    this.onResponse = options.onResponse;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, query, timeout = this.timeout } = options;
    const url = this.baseUrl + path + serializeQuery(query);

    this.onRequest?.({ method, path, body });

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const startedAt = Date.now();
      try {
        const response = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeout),
        });

        const payload = await readBody(response);
        this.onResponse?.({
          method,
          path,
          status: response.status,
          durationMs: Date.now() - startedAt,
          body: payload,
        });

        if (response.ok) return payload as T;

        // A bad credential will not get better by asking again.
        if (response.status === 401 || response.status === 403) {
          throw new AuthError();
        }

        const error = new ApiError(
          response.status,
          payload,
          errorMessage(payload, response.status),
        );
        if (!RETRYABLE_STATUS.has(response.status)) throw error;
        lastError = error;
      } catch (err) {
        // Thrown by us above, or by a genuine network/timeout failure.
        if (err instanceof AuthError || err instanceof ApiError) {
          if (!(err instanceof ApiError) || !RETRYABLE_STATUS.has(err.status)) {
            throw err;
          }
          lastError = err;
        } else {
          lastError = new NetworkError(`Request to ${url} failed`, err);
        }
      }

      if (attempt < this.maxRetries) {
        // Exponential backoff with jitter, so a fleet of clients recovering
        // from the same blip does not retry in lockstep.
        const backoff = 250 * 2 ** attempt;
        await sleep(backoff + Math.random() * backoff);
      }
    }

    throw lastError;
  }
}

function serializeQuery(
  query: RequestOptions['query'],
): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return params.size > 0 ? `?${params}` : '';
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  return response.json().catch(() => null);
}

function errorMessage(payload: unknown, status: number): string {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'error' in payload &&
    typeof payload.error === 'string'
  ) {
    return payload.error;
  }
  return `Request failed with status ${status}`;
}

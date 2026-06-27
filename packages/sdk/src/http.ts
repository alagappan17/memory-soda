import { ApiError, AuthError, NetworkError } from './errors.js';

export interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  /** Per-call timeout in ms. Falls back to the client default when omitted. */
  timeoutMs?: number;
  /** Max retry attempts for transient failures (network / 429 / 5xx). */
  maxRetries?: number;
  /** Idempotency key sent as the `Idempotency-Key` header (write safety). */
  idempotencyKey?: string;
  /** Extra headers merged into the request. */
  headers?: Record<string, string>;
}

/** Per-call overrides accepted by public SDK methods. */
export interface CallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export function uuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt: number, retryAfter?: string | null): number {
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (!Number.isNaN(secs)) return secs * 1000;
  }
  const base = Math.min(1000 * 2 ** attempt, 8000);
  return base + Math.random() * 250; // jitter
}

export async function request<T>(
  baseUrl: string,
  apiKey: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`;
  const { method = 'GET', body, signal, timeoutMs, idempotencyKey, headers = {} } = options;
  const maxRetries = options.maxRetries ?? 2;

  const reqHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    ...headers,
  };
  if (idempotencyKey) reqHeaders['Idempotency-Key'] = idempotencyKey;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Compose a per-attempt timeout signal with any caller-provided signal.
    const signals: AbortSignal[] = [];
    if (signal) signals.push(signal);
    if (timeoutMs) signals.push(AbortSignal.timeout(timeoutMs));
    const composed = signals.length > 1 ? AbortSignal.any(signals) : signals[0];

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: reqHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: composed,
      });
    } catch (err) {
      // A caller-driven abort should not be retried.
      if (signal?.aborted) throw new NetworkError(`Request to ${url} aborted`, err);
      lastError = new NetworkError(`Request to ${url} failed`, err);
      if (attempt < maxRetries) {
        await sleep(backoffDelay(attempt));
        continue;
      }
      throw lastError;
    }

    if (response.status === 401 || response.status === 403) {
      throw new AuthError();
    }

    if (RETRYABLE_STATUS.has(response.status) && attempt < maxRetries) {
      await sleep(backoffDelay(attempt, response.headers.get('retry-after')));
      continue;
    }

    if (!response.ok) {
      let errBody: unknown;
      try {
        errBody = await response.json();
      } catch {
        errBody = null;
      }
      throw new ApiError(
        response.status,
        errBody,
        `Request failed with status ${response.status}`,
      );
    }

    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  throw lastError ?? new NetworkError(`Request to ${url} failed`);
}

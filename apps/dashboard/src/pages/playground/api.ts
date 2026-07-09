import { API_URL } from '../../lib/api';
import type { OpTrace } from './types';

interface CallOpts {
  method?: string;
  body?: unknown;
}

export class ApiError extends Error {
  trace: OpTrace;
  constructor(message: string, trace: OpTrace) {
    super(message);
    this.trace = trace;
  }
}

/**
 * Fetch with the playground API key. Returns the parsed data plus a network
 * trace ({ method, path, request, response, status, duration }) so ops can be
 * rendered network-inspector style.
 */
export async function trackedFetch<T>(
  apiKey: string,
  path: string,
  opts: CallOpts = {},
): Promise<{ data: T; trace: OpTrace }> {
  const method = opts.method ?? 'GET';
  const t0 = Date.now();
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const durationMs = Date.now() - t0;
  const json = (await res.json().catch(() => null)) as unknown;
  const trace: OpTrace = {
    method,
    path,
    requestBody: opts.body,
    responseBody: json,
    status: res.status,
    durationMs,
  };
  if (!res.ok) {
    const message =
      (json as { error?: string } | null)?.error ?? res.statusText;
    throw new ApiError(message, trace);
  }
  return { data: json as T, trace };
}

/** trackedFetch minus the trace — for silent background reads (polling, stats). */
export async function quietFetch<T>(
  apiKey: string,
  path: string,
  opts: CallOpts = {},
): Promise<T> {
  const { data } = await trackedFetch<T>(apiKey, path, opts);
  return data;
}

/** Uniform message + trace extraction for catch blocks feeding the ops log. */
export function describeError(
  err: unknown,
  fallback: string,
): { message: string; trace?: OpTrace } {
  return {
    message: err instanceof Error ? err.message : fallback,
    trace: err instanceof ApiError ? err.trace : undefined,
  };
}

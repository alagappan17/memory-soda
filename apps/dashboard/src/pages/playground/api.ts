import { MemorySoda } from '@memory-soda/sdk';
import type { WMChatResponse } from '@memory-soda/types';
import api, { API_URL } from '../../lib/api';
import type { OpTrace } from './types';

/**
 * The playground talks to the API through the published SDK, not through its
 * own HTTP layer.
 *
 * It is the only place we use the client the way a customer does, so it is the
 * only place its ergonomics get tested. The network trace the ops log renders
 * comes from the SDK's own `onRequest`/`onResponse` hooks, a feature users
 * have too, rather than instrumentation that only exists here.
 */

export class PlaygroundError extends Error {
  constructor(
    message: string,
    readonly trace: OpTrace | undefined,
  ) {
    super(message);
    this.name = 'PlaygroundError';
  }
}

/**
 * Run one SDK call and capture what went over the wire.
 *
 * A client per call rather than one shared instance: the hooks close over this
 * call's trace, so concurrent calls cannot overwrite each other's.
 */
export async function call<T>(
  apiKey: string,
  fn: (memory: MemorySoda) => Promise<T>,
): Promise<{ data: T; trace: OpTrace }> {
  let trace: OpTrace | undefined;
  const startedAt = Date.now();

  const memory = new MemorySoda({
    baseUrl: API_URL,
    apiKey,
    // The playground shows what the API did; a retry would hide the first
    // failure behind a success and make the ops log lie.
    maxRetries: 0,
    onRequest: ({ method, path, body }) => {
      trace = { method, path, requestBody: body };
    },
    onResponse: ({ method, path, status, durationMs, body }) => {
      trace = {
        method,
        path,
        requestBody: trace?.requestBody,
        responseBody: body,
        status,
        durationMs,
      };
    },
  });

  try {
    const data = await fn(memory);
    return { data, trace: trace ?? fallbackTrace(startedAt) };
  } catch (err) {
    throw new PlaygroundError(
      err instanceof Error ? err.message : 'Request failed',
      trace,
    );
  }
}

/** `call` without the trace, for background reads that should not log an op. */
export async function quiet<T>(
  apiKey: string,
  fn: (memory: MemorySoda) => Promise<T>,
): Promise<T> {
  const { data } = await call(apiKey, fn);
  return data;
}

/**
 * A traced call to the dashboard's own API surface.
 *
 * Compaction, thread stats, episode retry and delete, and the entity list are
 * operator tools, not things an integration does on a chat turn, so they are
 * not on the SDK. The playground still offers them, and still logs them,
 * through the session-authenticated `/dashboard/v1` mount, which serves the
 * same memory routes the API key surface does.
 */
export async function adminCall<T>(
  projectId: string,
  method: 'get' | 'post' | 'delete',
  path: string,
): Promise<{ data: T; trace: OpTrace }> {
  const startedAt = Date.now();
  const fullPath = `/dashboard/v1${path}`;
  try {
    const res = await api.request<T>({
      method,
      url: fullPath,
      params: { projectId },
    });
    return {
      data: res.data,
      trace: {
        method: method.toUpperCase(),
        path: fullPath,
        responseBody: res.data,
        status: res.status,
        durationMs: Date.now() - startedAt,
      },
    };
  } catch (err) {
    throw new PlaygroundError(
      describe(err, `${method.toUpperCase()} ${fullPath} failed`),
      {
        method: method.toUpperCase(),
        path: fullPath,
        durationMs: Date.now() - startedAt,
      },
    );
  }
}

/**
 * A chat turn, where the server runs the model.
 *
 * Not on the SDK on purpose: integrators run their own model and use
 * `prepare()` + `recall()`. This is a dashboard convenience, so it goes over
 * the dashboard's session-authenticated route.
 */
export async function chatTurn(
  projectId: string,
  threadId: string,
  body: {
    content: string;
    systemPrompt?: string;
    messageLimit?: number;
    verbose?: boolean;
  },
): Promise<{ data: WMChatResponse; trace: OpTrace }> {
  const path = `/dashboard/chat/threads/${threadId}/chat`;
  const startedAt = Date.now();
  try {
    const res = await api.post<WMChatResponse>(path, body, {
      params: { projectId },
    });
    return {
      data: res.data,
      trace: {
        method: 'POST',
        path,
        requestBody: body,
        responseBody: res.data,
        status: res.status,
        durationMs: Date.now() - startedAt,
      },
    };
  } catch (err) {
    throw new PlaygroundError(describe(err, 'Chat turn failed'), {
      method: 'POST',
      path,
      requestBody: body,
      durationMs: Date.now() - startedAt,
    });
  }
}

/** Uniform message + trace extraction for catch blocks feeding the ops log. */
export function describeError(
  err: unknown,
  fallback: string,
): { message: string; trace?: OpTrace } {
  return {
    message: describe(err, fallback),
    ...(err instanceof PlaygroundError && err.trace
      ? { trace: err.trace }
      : {}),
  };
}

function describe(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/** A call that never reached the network still deserves a row in the log. */
function fallbackTrace(startedAt: number): OpTrace {
  return {
    method: 'GET',
    path: '(no request)',
    durationMs: Date.now() - startedAt,
  };
}

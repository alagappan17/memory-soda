import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { UsageKind, UsageSource } from '@memory-soda/types';

/**
 * Usage log: who did what, with which model, for how long, at what cost.
 *
 * Designed to never touch request latency. `log()` is a synchronous array
 * push; a timer batches the buffer into one INSERT. Losing a few rows on a
 * crash is acceptable, slowing the API is not.
 *
 * Context (source, request id, project, thread…) is carried by
 * AsyncLocalStorage from the two entry points (HTTP middleware, worker job) so
 * the model client and the services never thread it through their arguments.
 */

export interface UsageContext {
  source: UsageSource;
  requestId: string;
  operation: string;
  projectId?: string;
  dataset?: string;
  apiKeyId?: string;
  userId?: string;
  threadId?: string;
  episodeId?: string;
}

const storage = new AsyncLocalStorage<UsageContext>();

export function runWithUsage<T>(
  ctx: Omit<UsageContext, 'requestId'> & { requestId?: string },
  fn: () => T,
): T {
  return storage.run({ requestId: randomUUID(), ...ctx }, fn);
}

/** Add what is only known mid-flight (thread, episode, dataset). */
export function extendUsage(patch: Partial<UsageContext>): void {
  const store = storage.getStore();
  if (store) Object.assign(store, store, patch);
}

export function currentUsage(): UsageContext | undefined {
  return storage.getStore();
}

export interface UsageEvent {
  stage: string;
  kind: UsageKind;
  latencyMs: number;
  ok?: boolean;
  error?: string | null;
  service?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  inputChars?: number;
  calls?: number;
  meta?: Record<string, unknown>;
  /** Overrides for the context values, e.g. a span logged after the run. */
  projectId?: string;
  dataset?: string;
  threadId?: string;
  episodeId?: string;
  operation?: string;
}

export interface UsageRow extends UsageContext {
  projectId: string;
  stage: string;
  kind: UsageKind;
  latencyMs: number;
  ok: boolean;
  error: string | null;
  service: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  inputChars: number;
  calls: number;
  meta: Record<string, unknown>;
  createdAt: Date;
}

// ponytail: in-process buffer, lost on crash. Move to a queue if exact
// accounting ever matters.
const MAX_BUFFER = 10_000;
let buffer: UsageRow[] = [];

/** Sync, allocation-only. No projectId (tests, unscoped calls) → dropped. */
export function log(ev: UsageEvent): void {
  const ctx = storage.getStore();
  const projectId = ev.projectId ?? ctx?.projectId;
  if (!projectId) return;
  if (buffer.length >= MAX_BUFFER) buffer.shift();
  buffer.push({
    source: ctx?.source ?? 'api',
    requestId: ctx?.requestId ?? randomUUID(),
    operation: ev.operation ?? ctx?.operation ?? 'unknown',
    apiKeyId: ctx?.apiKeyId,
    userId: ctx?.userId,
    dataset: ev.dataset ?? ctx?.dataset,
    threadId: ev.threadId ?? ctx?.threadId,
    episodeId: ev.episodeId ?? ctx?.episodeId,
    projectId,
    stage: ev.stage,
    kind: ev.kind,
    latencyMs: Math.round(ev.latencyMs),
    ok: ev.ok ?? true,
    error: ev.error ? ev.error.slice(0, 500) : null,
    service: ev.service ?? null,
    model: ev.model ?? null,
    inputTokens: ev.inputTokens ?? 0,
    outputTokens: ev.outputTokens ?? 0,
    inputChars: ev.inputChars ?? 0,
    calls: ev.calls ?? 1,
    meta: ev.meta ?? {},
    createdAt: new Date(),
  });
}

/** Time a promise and log it; rethrows so callers keep their own handling. */
export async function timed<T>(
  ev: Omit<UsageEvent, 'latencyMs' | 'ok' | 'error'>,
  fn: () => Promise<T>,
  onResult?: (result: T) => Partial<UsageEvent>,
): Promise<T> {
  const t0 = Date.now();
  try {
    const result = await fn();
    log({ ...ev, ...onResult?.(result), latencyMs: Date.now() - t0 });
    return result;
  } catch (err) {
    log({
      ...ev,
      latencyMs: Date.now() - t0,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export type UsageSink = (rows: UsageRow[]) => Promise<unknown>;

export function drain(): UsageRow[] {
  const rows = buffer;
  buffer = [];
  return rows;
}

let timer: NodeJS.Timeout | null = null;
let sink: UsageSink | null = null;

export async function flush(): Promise<void> {
  if (!sink) return;
  const rows = drain();
  if (rows.length === 0) return;
  try {
    await sink(rows);
  } catch (err) {
    console.error('[usage] flush failed, dropping', rows.length, 'rows:', err);
  }
}

/** Start batching. The sink is injected so this module stays DB-free. */
export function startUsageFlusher(s: UsageSink, intervalMs = 5_000): void {
  sink = s;
  if (timer) return;
  timer = setInterval(() => void flush(), intervalMs);
  // A pending flush must never hold the process open on shutdown.
  timer.unref();
}

export function stopUsageFlusher(): void {
  if (timer) clearInterval(timer);
  timer = null;
  sink = null;
}

// ── Pricing ───────────────────────────────────────────────────────────────────

/** USD per million tokens, keyed `service:model`. Add a row per new model. */
export const PRICES: Record<string, { input: number; output: number }> = {
  'gemini:gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini:gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
  'gemini:gemini-2.5-pro': { input: 1.25, output: 10 },
  'gemini:gemini-embedding-001': { input: 0.15, output: 0 },
};

/** Gemini's embedding API returns no token count; ~4 chars per token. */
const CHARS_PER_TOKEN = 4;

export function costOf(row: {
  service: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  inputChars: number;
}): number | null {
  if (!row.service || !row.model) return null;
  const price = PRICES[`${row.service}:${row.model.replace(/^models\//, '')}`];
  if (!price) return null;
  const input =
    row.inputTokens > 0 ? row.inputTokens : row.inputChars / CHARS_PER_TOKEN;
  return (input * price.input + row.outputTokens * price.output) / 1_000_000;
}

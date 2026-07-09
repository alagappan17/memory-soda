export type OpType =
  | 'thread_created'
  | 'message_added'
  | 'manual_message_added'
  | 'ai_replied'
  | 'prepare'
  | 'recall'
  | 'auto_compacted'
  | 'compacted'
  | 'thread_ended'
  | 'episode_scheduled'
  | 'episodes_loaded'
  | 'episode_search'
  | 'episode_retried'
  | 'episode_deleted'
  | 'episode_failed'
  | 'facts_extracted'
  | 'fact_deleted'
  | 'note'
  | 'error';

/** Network capture of a single API call, attached to ops for inspector-style display. */
export interface OpTrace {
  method: string;
  path: string;
  requestBody?: unknown;
  responseBody?: unknown;
  status?: number;
  durationMs?: number;
}

export interface Operation {
  id: number;
  type: OpType;
  ts: number;
  durationMs?: number;
  /** Drives the one-line subtitle in the ops log. */
  summary: Record<string, unknown>;
  request?: { method: string; path: string; body?: unknown };
  response?: unknown;
}

/** Shared signature of useOps().addOp — the single way anything logs an op. */
export type AddOp = (
  type: OpType,
  summary: Record<string, unknown>,
  trace?: OpTrace,
  responseOverride?: unknown,
) => void;

export interface WMSettings {
  autoCompactEnabled: boolean;
  autoCompactThreshold: number;
  messageLimit: number;
}

export interface RecallControls {
  query: string;
  /** null = use the project's retrievalMinConfidence default. */
  minConfidence: number | null;
  /** null = use the project's factsInContext default. */
  limit: number | null;
  includeEpisodes: boolean;
  includeSynthesis: boolean;
  includeRaw: boolean;
  /** datetime-local value; '' = live recall. */
  asOf: string;
}

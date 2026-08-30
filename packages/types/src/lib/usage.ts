// ── Usage log ─────────────────────────────────────────────────────────────────
//
// One row per unit of work that costs money or time: a model call, an
// embedding batch, or a timed span (a whole recall, an episode, an HTTP
// request). Provider-neutral: `service` + `model` identify the price.

export type UsageSource = 'api' | 'dashboard' | 'worker';
export type UsageKind = 'llm' | 'embed' | 'span';

export interface UsageLogRow {
  id: string;
  createdAt: string;
  projectId: string;
  dataset: string | null;
  source: UsageSource;
  apiKeyId: string | null;
  userId: string | null;
  requestId: string | null;
  operation: string;
  stage: string;
  kind: UsageKind;
  service: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  inputChars: number;
  calls: number;
  latencyMs: number;
  ok: boolean;
  error: string | null;
  threadId: string | null;
  episodeId: string | null;
  meta: Record<string, unknown>;
  /** USD, computed from the price table at read time; null when unpriced. */
  costUsd: number | null;
}

export type UsageBucket = 'day' | 'week' | 'month';

export interface UsageTotals {
  calls: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  inputChars: number;
  costUsd: number;
  /** Whether any rows in the window had no price entry. */
  unpriced: boolean;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
}

/** One group of the breakdown; the page pivots these by any key. */
export interface UsageBreakdownRow extends UsageTotals {
  source: UsageSource;
  operation: string;
  stage: string;
  kind: UsageKind;
  service: string | null;
  model: string | null;
}

export interface UsageBucketRow {
  bucket: string;
  calls: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface UsageByKeyRow {
  key: string | null;
  label: string | null;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface MemoryCounts {
  threads: number;
  messages: number;
  /** Tokens the tenant's own app reported on stored messages. */
  messageTokens: number;
  episodes: Record<string, number>;
  factsLive: number;
  factsInvalidated: number;
  entities: number;
  datasets: number;
}

export interface MemoryGrowthRow {
  bucket: string;
  threads: number;
  messages: number;
  episodes: number;
  facts: number;
  entities: number;
}

export interface UsageSummary {
  from: string;
  to: string;
  bucket: UsageBucket;
  totals: UsageTotals;
  breakdown: UsageBreakdownRow[];
  byDataset: UsageByKeyRow[];
  byApiKey: UsageByKeyRow[];
  timeseries: UsageBucketRow[];
  memory: MemoryCounts;
  memoryGrowth: MemoryGrowthRow[];
}

export interface UsageLogsResponse {
  logs: UsageLogRow[];
  nextCursor: string | null;
}

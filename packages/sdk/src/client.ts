import { request, uuid, type CallOptions } from './http.js';
import type {
  HealthResponse,
  WMThread,
  WMCreateThreadRequest,
  WMCreateThreadResponse,
  WMPatchThreadRequest,
  WMEndThreadResponse,
  WMAddMessageRequest,
  WMAddMessageResponse,
  WMListMessagesQuery,
  WMListMessagesResponse,
  WMPrepareRequest,
  WMPrepareResponse,
  WMCompactResult,
  WMThreadStatsResponse,
  SemanticFact,
  SemanticFactsResponse,
  SemanticEntitiesResponse,
  SemanticRelationshipsResponse,
  EpisodesListResponse,
  EpisodesListQuery,
} from '@memory-soda/types';

export interface MemorySodaConfig {
  baseUrl: string;
  apiKey: string;
  timeout?: number;
}

export interface ListThreadsOptions extends CallOptions {
  userId?: string;
  limit?: number;
  cursor?: string;
}

export interface ListThreadsResponse {
  threads: WMThread[];
  hasMore: boolean;
  nextCursor: string | null;
}



const THREADS = '/v1/threads';
const MEMORY = '/v1/memory/threads';
const SEMANTIC = '/v1/memory/semantic';
const EPISODIC = '/v1/memory/episodic';

/**
 * Root client for the Memory Soda API.
 *
 * @example
 * ```ts
 * const client = new MemorySodaClient({ baseUrl: 'http://localhost:3004', apiKey: 'ms_...' });
 * const thread = await client.createThread({ userId: 'u1' });
 * await client.addMessage(thread.threadId, { role: 'user', content: 'Hello' });
 * const prepare = await client.prepare(thread.threadId, { query: 'Hello' });
 * // pass prepare.messages to your LLM, then addMessage the reply
 * ```
 */
export class MemorySodaClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeout: number;

  constructor(config: MemorySodaConfig) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.timeout = config.timeout ?? 60_000;
  }

  /**
   * Construct a client from `MEMORY_SODA_BASE_URL` and `MEMORY_SODA_API_KEY` environment variables.
   * @throws If either variable is missing.
   */
  static fromEnv(): MemorySodaClient {
    const baseUrl = process.env['MEMORY_SODA_BASE_URL'];
    const apiKey = process.env['MEMORY_SODA_API_KEY'];
    if (!baseUrl) throw new Error('MEMORY_SODA_BASE_URL environment variable is not set');
    if (!apiKey) throw new Error('MEMORY_SODA_API_KEY environment variable is not set');
    return new MemorySodaClient({ baseUrl, apiKey });
  }

  // ── Health ─────────────────────────────────────────────────────────────────

  /** Check health of the API and its backing services (Postgres, Redis, Neo4j). */
  health(call?: CallOptions): Promise<HealthResponse> {
    return request<HealthResponse>(this.baseUrl, this.apiKey, '/health', {
      timeoutMs: call?.timeoutMs ?? this.timeout,
      signal: call?.signal,
    });
  }

  /** Returns `{ ok, services }` — `ok` is true only when all services are healthy. */
  async ping(): Promise<{ ok: boolean; services: Record<string, string> }> {
    const h = await this.health();
    return {
      ok: h.status === 'ok',
      services: { postgres: h.services.postgres, redis: h.services.redis, neo4j: h.services.neo4j },
    };
  }

  // ── Threads ────────────────────────────────────────────────────────────────

  /**
   * Create a new conversation thread.
   *
   * @param opts.userId - Stable identifier for the user. Auto-generated if omitted.
   * @param opts.tags - Optional labels for filtering threads.
   * @param opts.metadata - Arbitrary key-value data attached to the thread.
   * @param opts.autoCompactThreshold - Auto-compact after this many un-compacted messages.
   * @param opts.settings - Per-thread overrides for episodic / semantic / working memory settings.
   */
  createThread(opts: WMCreateThreadRequest, call?: CallOptions): Promise<WMCreateThreadResponse> {
    return request(this.baseUrl, this.apiKey, THREADS, {
      method: 'POST',
      body: opts,
      timeoutMs: call?.timeoutMs ?? this.timeout,
      signal: call?.signal,
    });
  }

  /**
   * List threads for the authenticated project, newest activity first.
   *
   * @param opts.userId - Filter to a single user.
   * @param opts.limit - Page size (1–100, default 20).
   * @param opts.cursor - `nextCursor` from a previous page.
   */
  listThreads(opts: ListThreadsOptions = {}): Promise<ListThreadsResponse> {
    const params = new URLSearchParams();
    if (opts.userId !== undefined) params.set('userId', opts.userId);
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts.cursor !== undefined) params.set('cursor', opts.cursor);
    const qs = params.size > 0 ? `?${params}` : '';
    return request(this.baseUrl, this.apiKey, `${THREADS}${qs}`, {
      timeoutMs: opts.timeoutMs ?? this.timeout,
      signal: opts.signal,
    });
  }

  /** Fetch a thread by ID. */
  getThread(threadId: string, call?: CallOptions): Promise<WMThread> {
    return request(this.baseUrl, this.apiKey, `${THREADS}/${threadId}`, {
      timeoutMs: call?.timeoutMs ?? this.timeout,
      signal: call?.signal,
    });
  }

  /**
   * Merge-update a thread's metadata. Existing keys are preserved; only provided keys are overwritten.
   *
   * @param opts.metadata - Key-value pairs to merge into the thread's existing metadata.
   */
  updateThread(threadId: string, opts: WMPatchThreadRequest, call?: CallOptions): Promise<WMThread> {
    return request(this.baseUrl, this.apiKey, `${THREADS}/${threadId}`, {
      method: 'PATCH',
      body: opts,
      timeoutMs: call?.timeoutMs ?? this.timeout,
      signal: call?.signal,
    });
  }

  /**
   * Trigger episodic memory extraction for the thread. The thread remains writable after this call.
   *
   * @returns `{ threadId, episodeQueued: true }`.
   */
  endThread(threadId: string, call?: CallOptions): Promise<WMEndThreadResponse> {
    return request(this.baseUrl, this.apiKey, `${THREADS}/${threadId}/end`, {
      method: 'POST',
      timeoutMs: call?.timeoutMs ?? this.timeout,
      signal: call?.signal,
    });
  }

  // ── Messages ───────────────────────────────────────────────────────────────

  /**
   * Append a message to a thread. Auto-attaches an idempotency key so retries never double-write.
   *
   * @param opts.role - `user`, `assistant`, `system`, or `tool`.
   * @param opts.content - The message text.
   * @param opts.tokenCount - Optional token breakdown.
   * @param opts.model - Model ID used to generate the message.
   * @param opts.latencyMs - Time in ms the model took to respond.
   * @param opts.metadata - Optional structured metadata (`stopReason`, `agentName`).
   */
  addMessage(
    threadId: string,
    opts: WMAddMessageRequest,
    call?: CallOptions,
  ): Promise<WMAddMessageResponse> {
    return request(this.baseUrl, this.apiKey, `${MEMORY}/${threadId}/messages`, {
      method: 'POST',
      body: opts,
      idempotencyKey: uuid(),
      timeoutMs: call?.timeoutMs ?? this.timeout,
      signal: call?.signal,
    });
  }

  /**
   * List messages with cursor-based pagination.
   *
   * @param opts.limit - Max messages to return (1–100, default 20).
   * @param opts.before - Return messages with sequenceNumber less than this value.
   * @param opts.order - Sort direction (`asc` or `desc`, default `asc`).
   */
  listMessages(
    threadId: string,
    opts: WMListMessagesQuery = {},
    call?: CallOptions,
  ): Promise<WMListMessagesResponse> {
    const params = new URLSearchParams();
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts.before !== undefined) params.set('before', String(opts.before));
    if (opts.order !== undefined) params.set('order', opts.order);
    const qs = params.size > 0 ? `?${params}` : '';
    return request(this.baseUrl, this.apiKey, `${MEMORY}/${threadId}/messages${qs}`, {
      timeoutMs: call?.timeoutMs ?? this.timeout,
      signal: call?.signal,
    });
  }



  // ── Prepare ────────────────────────────────────────────────────────────────

  /**
   * Prepare cross-memory context for an LLM turn. Aggregates working memory messages,
   * episodic context, and semantic facts in one call.
   *
   * @param opts.messageLimit - Max recent messages to include (max 100). Falls back to thread/project default.
   * @param opts.query - Semantic query used to rank episodic and semantic memory retrieval.
   */
  prepare(
    threadId: string,
    opts: WMPrepareRequest = {},
    call?: CallOptions,
  ): Promise<WMPrepareResponse> {
    return request(this.baseUrl, this.apiKey, `${MEMORY}/${threadId}/prepare`, {
      method: 'POST',
      body: opts,
      timeoutMs: call?.timeoutMs ?? this.timeout,
      signal: call?.signal,
    });
  }

  // ── Compaction & stats ─────────────────────────────────────────────────────

  /**
   * Compact a thread by summarizing its un-compacted messages via LLM.
   * Auto-compact fires automatically after `addMessage` when `autoCompactThreshold` is set.
   */
  compact(threadId: string, call?: CallOptions): Promise<WMCompactResult> {
    return request(this.baseUrl, this.apiKey, `${MEMORY}/${threadId}/compact`, {
      method: 'POST',
      timeoutMs: call?.timeoutMs ?? this.timeout,
      signal: call?.signal,
    });
  }

  /** Token usage and session duration stats for a thread. */
  getThreadStats(threadId: string, call?: CallOptions): Promise<WMThreadStatsResponse> {
    return request(this.baseUrl, this.apiKey, `${MEMORY}/${threadId}/stats`, {
      timeoutMs: call?.timeoutMs ?? this.timeout,
      signal: call?.signal,
    });
  }

  // ── Semantic knowledge graph ───────────────────────────────────────────────

  /**
   * Query the user's semantic facts. Vector search when `query` is provided, else most-recent.
   */
  getFacts(
    userId: string,
    opts: { query?: string; limit?: number; includeInvalidated?: boolean } = {},
    call?: CallOptions,
  ): Promise<SemanticFactsResponse> {
    const params = new URLSearchParams();
    if (opts.query) params.set('q', opts.query);
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts.includeInvalidated) params.set('includeInvalidated', 'true');
    const qs = params.size > 0 ? `?${params}` : '';
    return request(
      this.baseUrl,
      this.apiKey,
      `${SEMANTIC}/users/${encodeURIComponent(userId)}/facts${qs}`,
      { timeoutMs: call?.timeoutMs ?? this.timeout, signal: call?.signal },
    );
  }

  /** List all entities in the user's knowledge graph. */
  getEntities(userId: string, call?: CallOptions): Promise<SemanticEntitiesResponse> {
    return request(
      this.baseUrl,
      this.apiKey,
      `${SEMANTIC}/users/${encodeURIComponent(userId)}/entities`,
      { timeoutMs: call?.timeoutMs ?? this.timeout, signal: call?.signal },
    );
  }

  /** List facts attached to a single entity. */
  getEntityFacts(
    userId: string,
    entityName: string,
    call?: CallOptions,
  ): Promise<{ facts: SemanticFact[] }> {
    return request(
      this.baseUrl,
      this.apiKey,
      `${SEMANTIC}/users/${encodeURIComponent(userId)}/entities/${encodeURIComponent(entityName)}/facts`,
      { timeoutMs: call?.timeoutMs ?? this.timeout, signal: call?.signal },
    );
  }

  /** Query entity-to-entity relationships in the user's knowledge graph. */
  getRelationships(
    userId: string,
    opts: { query?: string; limit?: number } = {},
    call?: CallOptions,
  ): Promise<SemanticRelationshipsResponse> {
    const params = new URLSearchParams();
    if (opts.query) params.set('q', opts.query);
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    const qs = params.size > 0 ? `?${params}` : '';
    return request(
      this.baseUrl,
      this.apiKey,
      `${SEMANTIC}/users/${encodeURIComponent(userId)}/relationships${qs}`,
      { timeoutMs: call?.timeoutMs ?? this.timeout, signal: call?.signal },
    );
  }

  /** Soft-delete (invalidate) a semantic fact by ID. */
  deleteFact(factId: string, call?: CallOptions): Promise<{ ok: true }> {
    return request(
      this.baseUrl,
      this.apiKey,
      `${SEMANTIC}/facts/${encodeURIComponent(factId)}`,
      { method: 'DELETE', timeoutMs: call?.timeoutMs ?? this.timeout, signal: call?.signal },
    );
  }

  // ── Episodic memory ────────────────────────────────────────────────────────

  /** List episodes for a user, newest first. */
  listEpisodes(
    userId: string,
    opts: EpisodesListQuery = {},
    call?: CallOptions,
  ): Promise<EpisodesListResponse> {
    const params = new URLSearchParams();
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts.status !== undefined) params.set('status', opts.status);
    const qs = params.size > 0 ? `?${params}` : '';
    return request(
      this.baseUrl,
      this.apiKey,
      `${EPISODIC}/users/${encodeURIComponent(userId)}/episodes${qs}`,
      { timeoutMs: call?.timeoutMs ?? this.timeout, signal: call?.signal },
    );
  }
}

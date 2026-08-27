import { Http, type OnRequest, type OnResponse } from './http.js';
import type {
  DatasetDeletion,
  DatasetExport,
  Episode,
  EpisodeStatus,
  EpisodeWithRelevance,
  EpisodesListResponse,
  HealthResponse,
  RecallRequest,
  RecallResponse,
  SemanticEntity,
  SemanticFactsResponse,
  WMAddMessageRequest,
  WMAddMessageResponse,
  WMCompactResult,
  WMCreateThreadRequest,
  WMCreateThreadResponse,
  WMListMessagesQuery,
  WMListMessagesResponse,
  WMPatchThreadRequest,
  WMPrepareRequest,
  WMPrepareResponse,
  WMEndThreadResponse,
  WMThread,
} from '@memory-soda/types';

export interface MemorySodaConfig {
  /** Where the API is reachable. Defaults to `MEMORY_SODA_BASE_URL`. */
  baseUrl?: string;
  /** Defaults to `MEMORY_SODA_API_KEY`. */
  apiKey?: string;
  /** Per-request timeout in milliseconds. Default 60s. */
  timeout?: number;
  /** Retries for transient failures (429, 5xx, network). Default 2. */
  maxRetries?: number;
  /** Called before every request — useful for logging and inspection. */
  onRequest?: OnRequest;
  /** Called after every request, including failures. */
  onResponse?: OnResponse;
}

export interface ListFactsOptions {
  /** Keyword (full-text) filter. */
  q?: string;
  limit?: number;
  /** Include superseded and deleted facts. */
  includeInvalidated?: boolean;
  /** Point-in-time: what was true at this instant. Overrides `includeInvalidated`. */
  asOf?: string | Date;
  /** Provenance filter: only facts extracted from this episode. */
  episodeId?: string;
  /**
   * Only facts anchored to this entity. Entity names are stored lowercased and
   * matched that way, so casing here does not matter.
   */
  entity?: string;
}

/** What {@link MemorySoda.compact} answers when the thread had nothing to fold. */
export interface WMNothingToCompact {
  ok: true;
  compacted: false;
  message: string;
}

export interface ListEpisodesOptions {
  limit?: number;
  /** Cursor: return episodes created before this ISO timestamp. */
  before?: string;
  /** Defaults to `completed` — pending and failed episodes are hidden. */
  status?: EpisodeStatus | 'all';
}

/**
 * The Memory Soda client.
 *
 * Every method lives here rather than under a namespace: the API is a handful
 * of verbs over two nouns (a thread, a dataset), not a matrix of resources
 * sharing one set of CRUD verbs, so `listFacts(dataset)` says at the call site
 * what `facts.list(dataset)` only said at the receiver.
 *
 * The names carry their own tiering. The calls a chat turn makes are short —
 * `recall`, `prepare`, `addMessage`; the occasional ones are compound —
 * `listFacts`, `exportDataset`, `searchEpisodes`.
 *
 * @example
 * ```ts
 * const memory = new MemorySoda();                    // reads the environment
 * const { threadId, dataset } = await memory.createThread({ dataset: 'u_42' });
 *
 * await memory.addMessage(threadId, { role: 'user', content: input });
 * const { context } = await memory.recall({ dataset, query: input });
 * ```
 */
export class MemorySoda {
  private readonly http: Http;

  constructor(config: MemorySodaConfig = {}) {
    const baseUrl = config.baseUrl ?? process.env['MEMORY_SODA_BASE_URL'];
    const apiKey = config.apiKey ?? process.env['MEMORY_SODA_API_KEY'];

    if (!baseUrl) {
      throw new Error(
        'No baseUrl: pass one, or set MEMORY_SODA_BASE_URL in the environment',
      );
    }
    if (!apiKey) {
      throw new Error(
        'No apiKey: pass one, or set MEMORY_SODA_API_KEY in the environment',
      );
    }

    this.http = new Http({
      baseUrl,
      apiKey,
      ...(config.timeout === undefined ? {} : { timeout: config.timeout }),
      ...(config.maxRetries === undefined
        ? {}
        : { maxRetries: config.maxRetries }),
      ...(config.onRequest === undefined ? {} : { onRequest: config.onRequest }),
      ...(config.onResponse === undefined
        ? {}
        : { onResponse: config.onResponse }),
    });
  }

  // ── Threads ────────────────────────────────────────────────────────────────

  /**
   * Start a conversation. A thread is where messages accumulate, and therefore
   * where every durable memory ultimately comes from.
   *
   * @param opts.dataset Stable identifier for whose memory this is. Generated
   *   when omitted, and returned so you can store it.
   * @param opts.autoCompactThreshold Fold history into a summary once this many
   *   un-compacted messages accumulate.
   * @param opts.settings.episodic Patch over the project's episodic settings.
   */
  createThread(
    opts: WMCreateThreadRequest = {},
  ): Promise<WMCreateThreadResponse> {
    return this.http.request('/v1/threads', { method: 'POST', body: opts });
  }

  getThread(threadId: string): Promise<WMThread> {
    return this.http.request(`/v1/threads/${threadId}`);
  }

  /** Merge keys into the thread's metadata; existing keys are preserved. */
  updateThread(
    threadId: string,
    opts: WMPatchThreadRequest,
  ): Promise<WMThread> {
    return this.http.request(`/v1/threads/${threadId}`, {
      method: 'PATCH',
      body: opts,
    });
  }

  /**
   * Mark a natural break and queue episodic extraction over everything said
   * since the last episode. The thread stays writable.
   *
   * `episodeQueued` is false when nothing new has been said.
   */
  endThread(threadId: string): Promise<WMEndThreadResponse> {
    return this.http.request(`/v1/threads/${threadId}/end`, { method: 'POST' });
  }

  // ── Writing the conversation ───────────────────────────────────────────────

  /**
   * Append a message. The sequence number is assigned server-side.
   *
   * This is the only write path into long-term memory — what you append here is
   * what extraction later reads and turns into facts.
   */
  addMessage(
    threadId: string,
    message: WMAddMessageRequest,
  ): Promise<WMAddMessageResponse> {
    return this.http.request(
      `/v1/memory/working/threads/${threadId}/messages`,
      { method: 'POST', body: message },
    );
  }

  /** Append several messages in order — a whole turn, including tool results. */
  async addMessages(
    threadId: string,
    messages: WMAddMessageRequest[],
  ): Promise<WMAddMessageResponse[]> {
    const saved: WMAddMessageResponse[] = [];
    // Sequential: sequence numbers are assigned per insert, and a parallel
    // burst would interleave the turn.
    for (const message of messages) {
      saved.push(await this.addMessage(threadId, message));
    }
    return saved;
  }

  /**
   * Raw thread history, including compaction summaries — for inspection and
   * export. To build the next prompt, use {@link prepare}.
   */
  listMessages(
    threadId: string,
    opts: WMListMessagesQuery = {},
  ): Promise<WMListMessagesResponse> {
    return this.http.request(
      `/v1/memory/working/threads/${threadId}/messages`,
      { query: { ...opts } },
    );
  }

  // ── Reading memory ─────────────────────────────────────────────────────────

  /**
   * The thread state to feed the next model call: the active compact summary
   * followed by recent messages, ready to pass to any chat API.
   *
   * Pure SQL — no embedding, no model call.
   *
   * @param opts.messageLimit Recent messages to include (default 20, max 100).
   *   Keep it at or above `autoCompactThreshold`, or messages between the
   *   summary and the tail are skipped — the response warns when they are.
   */
  prepare(
    threadId: string,
    opts: WMPrepareRequest = {},
  ): Promise<WMPrepareResponse> {
    return this.http.request(`/v1/memory/working/threads/${threadId}/prepare`, {
      method: 'POST',
      body: opts,
    });
  }

  /**
   * Recall long-term memory for a dataset. No thread needed.
   *
   * Returns a prompt-ready `context` block built from the dataset's facts. Opt
   * into `episodes` (cross-thread summaries), `synthesis` (a prose paragraph),
   * or `raw` (the structured facts behind the block) via `include`.
   *
   * Use it to personalise anything — a chat turn, a search page, a tool call.
   * For the conversation state itself, pair it with {@link prepare}.
   */
  recall(req: RecallRequest): Promise<RecallResponse> {
    return this.http.request('/v1/memory/recall', {
      method: 'POST',
      body: req,
    });
  }

  /**
   * Both halves of a chat turn at once: the thread's recent messages and the
   * dataset's long-term memory.
   *
   * Pass `dataset` when you know it and the two run in parallel; omit it and
   * recall waits for prepare to report which dataset the thread belongs to.
   */
  async prepareAndRecall(
    threadId: string,
    opts: Omit<RecallRequest, 'dataset'> & {
      dataset?: string;
      messageLimit?: number;
    } = {},
  ): Promise<{ prepared: WMPrepareResponse; recalled: RecallResponse }> {
    const { dataset, messageLimit, ...recallOpts } = opts;
    const prepareOpts = messageLimit === undefined ? {} : { messageLimit };

    if (dataset) {
      const [prepared, recalled] = await Promise.all([
        this.prepare(threadId, prepareOpts),
        this.recall({ dataset, ...recallOpts }),
      ]);
      return { prepared, recalled };
    }

    const prepared = await this.prepare(threadId, prepareOpts);
    const recalled = await this.recall({
      dataset: prepared.dataset,
      ...recallOpts,
    });
    return { prepared, recalled };
  }

  /**
   * Fold un-compacted messages into one rolling summary.
   *
   * Fires automatically after {@link addMessage} when the thread sets
   * `autoCompactThreshold`. Call it yourself when you would rather keep that
   * cost off the request path: leave the threshold unset and compact from a
   * background job instead.
   *
   * Returns `{ ok: true, compacted: false }` when there was nothing to do.
   */
  compact(threadId: string): Promise<WMCompactResult | WMNothingToCompact> {
    return this.http.request(`/v1/memory/working/threads/${threadId}/compact`, {
      method: 'POST',
    });
  }

  // ── Facts ──────────────────────────────────────────────────────────────────

  /**
   * A dataset's currently-true facts, most recent first.
   *
   * Facts are written by the extraction pipeline, never directly — this is for
   * reading what was learned, and {@link deleteFact} for correcting it.
   */
  async listFacts(
    dataset: string,
    opts: ListFactsOptions = {},
  ): Promise<SemanticFactsResponse> {
    const base = `/v1/memory/semantic/datasets/${encodeURIComponent(dataset)}`;

    // Entity-anchored facts are a different route rather than a filter on the
    // fact list, but that is the server's filing system, not a second concept
    // the caller should have to learn. It answers without a total, so one is
    // derived rather than letting the shape differ by which option was passed.
    if (opts.entity) {
      const { facts } = await this.http.request<
        Pick<SemanticFactsResponse, 'facts'>
      >(`${base}/entities/${encodeURIComponent(opts.entity.toLowerCase())}/facts`);
      return { facts, total: facts.length };
    }

    return this.http.request(`${base}/facts`, {
      query: {
        q: opts.q,
        limit: opts.limit,
        includeInvalidated: opts.includeInvalidated,
        episodeId: opts.episodeId,
        asOf: opts.asOf instanceof Date ? opts.asOf.toISOString() : opts.asOf,
      },
    });
  }

  /**
   * Retire a fact the system got wrong.
   *
   * A soft delete: the row is stamped invalid rather than removed, so
   * point-in-time recall still reports what was believed before the correction.
   * Use {@link forgetDataset} to actually erase.
   */
  deleteFact(
    dataset: string,
    factId: string,
  ): Promise<{ factId: string; deleted: boolean }> {
    return this.http.request(
      `/v1/memory/semantic/datasets/${encodeURIComponent(dataset)}/facts/${factId}`,
      { method: 'DELETE' },
    );
  }

  /**
   * The resolved entities a dataset's facts refer to.
   *
   * Entities are how "Sarah" and "Sarah Chen" become one thing, so this is the
   * read that shows what the system thinks it is tracking.
   */
  async listEntities(dataset: string): Promise<SemanticEntity[]> {
    const res = await this.http.request<{ entities: SemanticEntity[] }>(
      `/v1/memory/semantic/datasets/${encodeURIComponent(dataset)}/entities`,
    );
    return res.entities;
  }

  // ── Episodes ───────────────────────────────────────────────────────────────

  /**
   * A dataset's episodes — one summarised stretch of conversation each, newest
   * first. Mostly useful for seeing what the system made of a conversation.
   */
  listEpisodes(
    dataset: string,
    opts: ListEpisodesOptions = {},
  ): Promise<EpisodesListResponse> {
    return this.http.request(
      `/v1/memory/episodic/datasets/${encodeURIComponent(dataset)}/episodes`,
      { query: { ...opts } },
    );
  }

  /** Semantic search over a dataset's episode summaries. */
  async searchEpisodes(
    dataset: string,
    q: string,
    opts: { limit?: number } = {},
  ): Promise<EpisodeWithRelevance[]> {
    const res = await this.http.request<{ episodes: EpisodeWithRelevance[] }>(
      `/v1/memory/episodic/datasets/${encodeURIComponent(dataset)}/episodes/search`,
      { query: { q, limit: opts.limit } },
    );
    return res.episodes;
  }

  /**
   * One episode, including the diagnostics — `status`, `error`, `retryCount`.
   *
   * Pair it with {@link endThread} to watch a queued extraction settle.
   */
  async getEpisode(episodeId: string): Promise<Episode> {
    const res = await this.http.request<{ episode: Episode }>(
      `/v1/memory/episodic/episodes/${episodeId}`,
    );
    return res.episode;
  }

  // ── Whole datasets ─────────────────────────────────────────────────────────

  /**
   * Everything stored for a dataset: threads, messages, episodes, facts,
   * entities.
   *
   * A dataset usually maps to a person, so this and {@link forgetDataset} are
   * the two things that person is entitled to ask for.
   */
  exportDataset(dataset: string): Promise<DatasetExport> {
    return this.http.request(
      `/v1/memory/recall/datasets/${encodeURIComponent(dataset)}/export`,
    );
  }

  /**
   * Erase a dataset. A hard delete, not the soft invalidation
   * {@link deleteFact} performs — nothing survives to be recalled
   * point-in-time.
   */
  forgetDataset(dataset: string): Promise<DatasetDeletion> {
    return this.http.request(
      `/v1/memory/recall/datasets/${encodeURIComponent(dataset)}`,
      { method: 'DELETE' },
    );
  }

  // ── Misc ───────────────────────────────────────────────────────────────────

  /** Health of the API and the services behind it. */
  health(): Promise<HealthResponse> {
    return this.http.request('/health');
  }
}

import { request } from './http.js';
import { ThreadClient } from './thread.js';
import { WorkingMemoryClient } from './working-memory.js';
import { SemanticMemoryClient } from './semantic-memory.js';
import type {
  HealthResponse,
  RecallRequest,
  RecallResponse,
} from '@memory-soda/types';

export interface MemorySodaConfig {
  baseUrl: string;
  apiKey: string;
  timeout?: number;
}

/**
 * Root client for the Memory Soda API.
 *
 * @example
 * ```ts
 * const client = new MemorySodaClient({ baseUrl: 'http://localhost:3004', apiKey: 'ms_...' });
 * const thread = await client.threads.create({ dataset: 'u1' });
 * const prepare = await client.workingMemory.prepare(thread.threadId);
 * ```
 */
export class MemorySodaClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeout: number;

  /** Thread management — create, get, update, and end threads. */
  readonly threads: ThreadClient;

  /** Working Memory — conversation history, message storage, and LLM context preparation. */
  readonly workingMemory: WorkingMemoryClient;

  /** Semantic Memory — durable facts and resolved entities learned about a user. */
  readonly semantic: SemanticMemoryClient;

  constructor(config: MemorySodaConfig) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.timeout = config.timeout ?? 60_000;
    this.threads = new ThreadClient(this.baseUrl, this.apiKey, () =>
      this.signal(),
    );
    this.workingMemory = new WorkingMemoryClient(
      this.baseUrl,
      this.apiKey,
      () => this.signal(),
      this.threads,
    );
    this.semantic = new SemanticMemoryClient(
      this.baseUrl,
      this.apiKey,
      () => this.signal(),
    );
  }

  /**
   * Construct a client from `MEMORY_SODA_BASE_URL` and `MEMORY_SODA_API_KEY` environment variables.
   * @throws If either environment variable is missing.
   */
  static fromEnv(): MemorySodaClient {
    const baseUrl = process.env['MEMORY_SODA_BASE_URL'];
    const apiKey = process.env['MEMORY_SODA_API_KEY'];
    if (!baseUrl)
      throw new Error('MEMORY_SODA_BASE_URL environment variable is not set');
    if (!apiKey)
      throw new Error('MEMORY_SODA_API_KEY environment variable is not set');
    return new MemorySodaClient({ baseUrl, apiKey });
  }

  private signal(): AbortSignal {
    return AbortSignal.timeout(this.timeout);
  }

  /**
   * Recall long-term memory for a dataset — no thread required. Returns a
   * prompt-ready `context` block built from the dataset's facts; opt into
   * `episodes` (cross-thread context), `synthesis` (prose summary), or `raw`
   * (structured facts/groups) via `include`.
   *
   * Use this to personalize any request: a chat turn, a search page, an agent
   * tool call. For conversation state, pair it with `workingMemory.prepare()`.
   */
  async recall(req: RecallRequest): Promise<RecallResponse> {
    return request<RecallResponse>(
      this.baseUrl,
      this.apiKey,
      '/v1/memory/recall',
      { method: 'POST', body: req, signal: this.signal() },
    );
  }

  /**
   * Chat-app convenience: fetch working memory (prepare) and long-term memory
   * (recall) in parallel for one turn. Pass the dataset if you know it (true
   * parallelism); omit it to read it from the prepare result (recall then runs
   * after prepare resolves).
   */
  async prepareAndRecall(
    threadId: string,
    opts: Omit<RecallRequest, 'dataset'> & {
      dataset?: string;
      messageLimit?: number;
    } = {},
  ): Promise<{
    prepared: Awaited<ReturnType<WorkingMemoryClient['prepare']>>;
    recalled: RecallResponse;
  }> {
    const { dataset, messageLimit, ...recallOpts } = opts;
    if (dataset) {
      const [prepared, recalled] = await Promise.all([
        this.workingMemory.prepare(threadId, { messageLimit }),
        this.recall({ dataset, ...recallOpts }),
      ]);
      return { prepared, recalled };
    }
    const prepared = await this.workingMemory.prepare(threadId, {
      messageLimit,
    });
    const recalled = await this.recall({
      dataset: prepared.dataset,
      ...recallOpts,
    });
    return { prepared, recalled };
  }

  /**
   * Check the health of the API and its backing services (Postgres).
   * @returns Health status per service.
   */
  async health(): Promise<HealthResponse> {
    return request<HealthResponse>(this.baseUrl, this.apiKey, '/health', {
      signal: this.signal(),
    });
  }

  /**
   * Simplified health check. Returns `ok: true` only if all services are healthy.
   * @returns `{ ok, services }` where `services` maps each service name to its status string.
   */
  async ping(): Promise<{ ok: boolean; services: Record<string, string> }> {
    const h = await this.health();
    return {
      ok: h.status === 'ok',
      services: {
        postgres: h.services.postgres,
      },
    };
  }
}

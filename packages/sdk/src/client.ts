import { request } from './http.js';
import { ThreadClient } from './thread.js';
import { WorkingMemoryClient } from './working-memory.js';
import type { HealthResponse } from '@memory-soda/types';

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
 * const thread = await client.threads.create({ userId: 'u1' });
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
   * Check the health of the API and its backing services (Postgres, Redis, Neo4j).
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
        redis: h.services.redis,
        neo4j: h.services.neo4j,
      },
    };
  }
}

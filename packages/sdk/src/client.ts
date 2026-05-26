import { request } from './http.js';
import type {
  HealthResponse,
  GraphAddRequest,
  GraphAddResponse,
  GraphRetrieveRequest,
  GraphRetrieveResponse,
  GraphChatRequest,
  GraphChatResponse,
  AddMemoryResult,
  RetrieveMemoryResult,
  Message,
} from './types.js';
import type { MemorySodaConfig } from './types.js';

export class MemorySodaClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeout: number;

  constructor(config: MemorySodaConfig) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.timeout = config.timeout ?? 60_000;
  }

  static fromEnv(): MemorySodaClient {
    const baseUrl = process.env['MEMORY_SODA_BASE_URL'];
    const apiKey = process.env['MEMORY_SODA_API_KEY'];
    if (!baseUrl) throw new Error('MEMORY_SODA_BASE_URL environment variable is not set');
    if (!apiKey) throw new Error('MEMORY_SODA_API_KEY environment variable is not set');
    return new MemorySodaClient({ baseUrl, apiKey });
  }

  private signal(): AbortSignal {
    return AbortSignal.timeout(this.timeout);
  }

  /** Extract facts from a conversation turn and store in the memory graph. */
  async add(userId: string, messages: Message[]): Promise<AddMemoryResult> {
    const res = await request<GraphAddResponse>(this.baseUrl, this.apiKey, '/graph/add', {
      method: 'POST',
      body: { userId, messages } satisfies GraphAddRequest,
      signal: this.signal(),
    });
    return res.result;
  }

  /** Retrieve relevant memories for a query and return a structured context block. */
  async retrieve(userId: string, query: string, limit?: number): Promise<RetrieveMemoryResult> {
    const res = await request<GraphRetrieveResponse>(this.baseUrl, this.apiKey, '/graph/retrieve', {
      method: 'POST',
      body: { userId, query, limit } satisfies GraphRetrieveRequest,
      signal: this.signal(),
    });
    return res.result;
  }

  /** Full agent turn: retrieve context → LLM call → store new memories. */
  async chat(
    userId: string,
    messages: Message[],
    systemPromptTemplate?: string,
  ): Promise<GraphChatResponse> {
    return request<GraphChatResponse>(this.baseUrl, this.apiKey, '/graph/chat', {
      method: 'POST',
      body: { userId, messages, systemPromptTemplate } satisfies GraphChatRequest,
      signal: this.signal(),
    });
  }

  async health(): Promise<HealthResponse> {
    return request<HealthResponse>(this.baseUrl, this.apiKey, '/health', {
      signal: this.signal(),
    });
  }

  /** Quick connectivity check. Resolves true if the API and all services are reachable. */
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

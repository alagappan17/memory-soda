import { request } from './http.js';
import type {
  SemanticEntity,
  SemanticFact,
  SemanticFactsResponse,
} from '@memory-soda/types';

const BASE = '/v1/memory/semantic';

/**
 * Semantic Memory — durable facts the system has learned about a user, plus the
 * resolved entities they mention. Facts are written automatically by the
 * extraction pipeline; this client is for reading and curating them.
 */
export class SemanticMemoryClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly signal: () => AbortSignal,
  ) {}

  /**
   * List a user's currently-valid facts (most recent first).
   *
   * @param userId - The user whose facts to list.
   * @param opts.q - Optional keyword (full-text) filter.
   * @param opts.limit - Max facts to return (1–100, default 50).
   * @param opts.includeInvalidated - Include superseded/deleted facts.
   */
  listFacts(
    userId: string,
    opts: { q?: string; limit?: number; includeInvalidated?: boolean } = {},
  ): Promise<SemanticFactsResponse> {
    const params = new URLSearchParams();
    if (opts.q !== undefined) params.set('q', opts.q);
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts.includeInvalidated !== undefined)
      params.set('includeInvalidated', String(opts.includeInvalidated));
    const qs = params.size > 0 ? `?${params}` : '';
    return request(
      this.baseUrl,
      this.apiKey,
      `${BASE}/users/${encodeURIComponent(userId)}/facts${qs}`,
      { signal: this.signal() },
    );
  }

  /** Keyword-search a user's facts. Convenience over `listFacts(userId, { q })`. */
  searchFacts(
    userId: string,
    q: string,
    opts: { limit?: number } = {},
  ): Promise<SemanticFactsResponse> {
    return this.listFacts(userId, { q, limit: opts.limit });
  }

  /** Soft-delete a fact (stamps invalidAt). */
  deleteFact(
    userId: string,
    factId: string,
  ): Promise<{ factId: string; deleted: boolean }> {
    return request(
      this.baseUrl,
      this.apiKey,
      `${BASE}/users/${encodeURIComponent(userId)}/facts/${factId}`,
      { method: 'DELETE', signal: this.signal() },
    );
  }

  /** List the resolved entities for a user. */
  async listEntities(userId: string): Promise<SemanticEntity[]> {
    const res = await request<{ entities: SemanticEntity[] }>(
      this.baseUrl,
      this.apiKey,
      `${BASE}/users/${encodeURIComponent(userId)}/entities`,
      { signal: this.signal() },
    );
    return res.entities;
  }

  /** List the live facts anchored to a named entity. */
  async listEntityFacts(
    userId: string,
    name: string,
  ): Promise<SemanticFact[]> {
    const res = await request<{ facts: SemanticFact[] }>(
      this.baseUrl,
      this.apiKey,
      `${BASE}/users/${encodeURIComponent(userId)}/entities/${encodeURIComponent(name)}/facts`,
      { signal: this.signal() },
    );
    return res.facts;
  }
}

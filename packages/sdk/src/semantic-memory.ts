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
   * @param dataset - The user whose facts to list.
   * @param opts.q - Optional keyword (full-text) filter.
   * @param opts.limit - Max facts to return (1–100, default 50).
   * @param opts.includeInvalidated - Include superseded/deleted facts.
   * @param opts.asOf - Point-in-time filter: facts that were true at this
   *   instant (ISO string or Date). Overrides includeInvalidated.
   */
  listFacts(
    dataset: string,
    opts: {
      q?: string;
      limit?: number;
      includeInvalidated?: boolean;
      asOf?: string | Date;
    } = {},
  ): Promise<SemanticFactsResponse> {
    const params = new URLSearchParams();
    if (opts.q !== undefined) params.set('q', opts.q);
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts.includeInvalidated !== undefined)
      params.set('includeInvalidated', String(opts.includeInvalidated));
    if (opts.asOf !== undefined)
      params.set(
        'asOf',
        opts.asOf instanceof Date ? opts.asOf.toISOString() : opts.asOf,
      );
    const qs = params.size > 0 ? `?${params}` : '';
    return request(
      this.baseUrl,
      this.apiKey,
      `${BASE}/datasets/${encodeURIComponent(dataset)}/facts${qs}`,
      { signal: this.signal() },
    );
  }

  /** Keyword-search a user's facts. Convenience over `listFacts(dataset, { q })`. */
  searchFacts(
    dataset: string,
    q: string,
    opts: { limit?: number } = {},
  ): Promise<SemanticFactsResponse> {
    return this.listFacts(dataset, { q, limit: opts.limit });
  }

  /** Soft-delete a fact (stamps invalidAt). */
  deleteFact(
    dataset: string,
    factId: string,
  ): Promise<{ factId: string; deleted: boolean }> {
    return request(
      this.baseUrl,
      this.apiKey,
      `${BASE}/datasets/${encodeURIComponent(dataset)}/facts/${factId}`,
      { method: 'DELETE', signal: this.signal() },
    );
  }

  /** List the resolved entities for a user. */
  async listEntities(dataset: string): Promise<SemanticEntity[]> {
    const res = await request<{ entities: SemanticEntity[] }>(
      this.baseUrl,
      this.apiKey,
      `${BASE}/datasets/${encodeURIComponent(dataset)}/entities`,
      { signal: this.signal() },
    );
    return res.entities;
  }

  /** List the live facts anchored to a named entity. */
  async listEntityFacts(
    dataset: string,
    name: string,
  ): Promise<SemanticFact[]> {
    const res = await request<{ facts: SemanticFact[] }>(
      this.baseUrl,
      this.apiKey,
      `${BASE}/datasets/${encodeURIComponent(dataset)}/entities/${encodeURIComponent(name)}/facts`,
      { signal: this.signal() },
    );
    return res.facts;
  }
}

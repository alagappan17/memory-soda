// ── Semantic Memory (Postgres fact store) ─────────────────────────────────────
//
// Facts are stored as subject–predicate–object triples but surfaced to callers
// primarily as rendered text (see `prepare.ts`). A single fact shape covers both
// literal facts (objectIsEntity=false) and entity↔entity relationships
// (objectIsEntity=true).
//
// Bi-temporal semantics: `validAt`→`validUntil` is when the fact is true in the
// world (validUntil may be future or past); `invalidAt` means superseded by a
// contradiction or soft-deleted. A fact is currently true when invalidAt is null
// and validUntil is null or in the future.

export const ENTITY_TYPES = [
  'PERSON',
  'ORG',
  'PLACE',
  'PRODUCT',
  'SKILL',
  'TOPIC',
  'EVENT',
  'FOOD',
  'ROLE',
  'CONCEPT',
  'THING',
  'DATE',
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export interface SemanticFact {
  factId: string;
  subject: string;
  predicate: string;
  object: string;
  objectIsEntity: boolean;
  /**
   * Model-rated extraction confidence (0–1). Every structurally-valid fact is
   * stored regardless; retrieval filters by the project's
   * retrievalMinConfidence (or a per-call override).
   */
  confidence: number;
  /** Verbatim supporting quote from the source transcript (provenance). */
  sourceQuote: string | null;
  validAt: string;
  validUntil: string | null;
  invalidAt: string | null;
  episodeId: string | null;
  /** Set on retrieval; the fused hybrid-retrieval relevance score. */
  relevanceScore?: number;
}

export interface SemanticEntity {
  entityId: string;
  name: string;
  type: EntityType;
}

/** Facts assembled for a single prepare() call (pre-render). */
export interface SemanticContext {
  facts: SemanticFact[];
  factCount: number;
}

export interface SemanticFactsQuery {
  q?: string;
  limit?: number;
  includeInvalidated?: boolean;
  /** Point-in-time filter: return facts that were true at this instant (ISO). Overrides includeInvalidated. */
  asOf?: string;
}

export interface SemanticFactsResponse {
  facts: SemanticFact[];
  total: number;
}

export interface SemanticEntitiesResponse {
  entities: SemanticEntity[];
}

export interface SemanticEntityFactsResponse {
  facts: SemanticFact[];
}

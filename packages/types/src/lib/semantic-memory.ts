// ── Semantic Memory (Postgres fact store) ─────────────────────────────────────
//
// Facts are stored as subject–predicate–object triples but surfaced to callers
// primarily as rendered text (see `prepare.ts`). A single fact shape covers both
// literal facts (objectIsEntity=false) and entity↔entity relationships
// (objectIsEntity=true). `invalidAt === null` means the fact is currently true.

export type EntityType =
  | 'PERSON'
  | 'ORG'
  | 'PLACE'
  | 'PRODUCT'
  | 'SKILL'
  | 'TOPIC'
  | 'EVENT'
  | 'FOOD'
  | 'ROLE'
  | 'CONCEPT'
  | 'THING'
  | 'DATE';

export interface SemanticFact {
  factId: string;
  subject: string;
  predicate: string;
  object: string;
  objectIsEntity: boolean;
  confidence: number;
  contextEntityName: string | null;
  validAt: string;
  ingestionAt: string;
  invalidAt: string | null;
  episodeId: string | null;
  /** Set on retrieval; the fused hybrid-retrieval relevance score. */
  relevanceScore?: number;
}

export interface SemanticEntity {
  entityId: string;
  name: string;
  type: EntityType;
  attributes: Record<string, unknown>;
  factCount: number;
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
}

export interface SemanticFactsResponse {
  facts: SemanticFact[];
  total: number;
}

export interface SemanticEntitiesResponse {
  entities: SemanticEntity[];
}

export interface SemanticEntityFactsResponse {
  entity: SemanticEntity;
  facts: SemanticFact[];
}

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
  userId: string;
  projectId: string;
  episodeId: string | null;
  validAt: string;
  ingestionAt: string;
  invalidAt: string | null;
  contextEntityName?: string | null;
  relevanceScore?: number;
}

export interface SemanticRelationship {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  userId: string;
  projectId: string;
  episodeId: string | null;
  validAt: string;
  invalidAt: string | null;
}

export interface SemanticEntity {
  entityId: string;
  name: string;
  type: EntityType;
  attributes: Record<string, unknown>;
  userId: string;
  projectId: string;
  factCount: number;
  relationshipCount: number;
}

export interface SemanticContext {
  facts: SemanticFact[];
  factCount: number;
  relationships: SemanticRelationship[];
  relationshipCount: number;
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

export interface SemanticRelationshipsResponse {
  relationships: SemanticRelationship[];
  total: number;
}

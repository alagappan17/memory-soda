export interface ProjectEpisodicSettings {
  enabled: boolean;
  autoEpisodeIntervalMs: number | null;
  maxMessages: number;
  maxRetries: number;
  contextEpisodes: number;
  similarityWeight: number;
  recencyWeight: number;
}

export const DEFAULT_EPISODIC_SETTINGS: ProjectEpisodicSettings = {
  enabled: true,
  autoEpisodeIntervalMs: 10_000,
  maxMessages: 100,
  maxRetries: 3,
  contextEpisodes: 3,
  similarityWeight: 0.7,
  recencyWeight: 0.3,
};

export interface ProjectSemanticSettings {
  enabled: boolean;
  /**
   * Retrieval confidence floor — every extracted fact is STORED with its
   * model-rated confidence; recall() excludes facts below this (per-call
   * override via RecallRequest.minConfidence). Also the floor below which a
   * new fact cannot invalidate an existing one.
   */
  retrievalMinConfidence: number;
  /** How many facts to retrieve into recall() context. */
  factsInContext: number;
  /** Cosine similarity above which two entities are merged during resolution. */
  entityResolutionThreshold: number;
  /** Cosine similarity above which a new fact is treated as a duplicate. */
  factDedupThreshold: number;
  /**
   * Lower bound of the contradiction band: a new fact is judged against live
   * facts whose embedding similarity is in [contradictionBandMin,
   * factDedupThreshold) even when predicates differ ("works at" vs "is
   * employed by").
   */
  contradictionBandMin: number;
  /** Min query↔entity embedding similarity for an entity to anchor retrieval. */
  anchorVectorMin: number;
  /** How many vector-matched anchor entities to admit per query. */
  anchorVectorTopK: number;
}

export const DEFAULT_SEMANTIC_SETTINGS: ProjectSemanticSettings = {
  enabled: true,
  retrievalMinConfidence: 0.5,
  factsInContext: 8,
  entityResolutionThreshold: 0.88,
  factDedupThreshold: 0.95,
  contradictionBandMin: 0.8,
  anchorVectorMin: 0.75,
  anchorVectorTopK: 3,
};

export interface ProjectSettings {
  episodic: ProjectEpisodicSettings;
  semantic: ProjectSemanticSettings;
}

export interface ProjectSettingsPatch {
  episodic?: Partial<ProjectEpisodicSettings>;
  semantic?: Partial<ProjectSemanticSettings>;
}

export function mergeWithDefaults(
  raw: ProjectSettingsPatch | null | undefined,
): ProjectSettings {
  return {
    episodic: { ...DEFAULT_EPISODIC_SETTINGS, ...(raw?.episodic ?? {}) },
    semantic: { ...DEFAULT_SEMANTIC_SETTINGS, ...(raw?.semantic ?? {}) },
  };
}

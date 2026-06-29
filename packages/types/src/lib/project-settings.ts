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
  /** Extraction confidence floor — facts below this are dropped. */
  minConfidence: number;
  /** How many facts to retrieve into prepare() context. */
  factsInContext: number;
  /** Cosine similarity above which two entities are merged during resolution. */
  entityResolutionThreshold: number;
  /** Cosine similarity above which a new fact is treated as a duplicate. */
  factDedupThreshold: number;
}

export const DEFAULT_SEMANTIC_SETTINGS: ProjectSemanticSettings = {
  enabled: true,
  minConfidence: 0.5,
  factsInContext: 8,
  entityResolutionThreshold: 0.88,
  factDedupThreshold: 0.95,
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

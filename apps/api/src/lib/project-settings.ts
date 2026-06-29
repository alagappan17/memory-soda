import type {
  ProjectEpisodicSettings,
  ProjectSemanticSettings,
  ProjectSettings,
  ProjectSettingsPatch,
} from '@memory-soda/types';

export const DEFAULT_EPISODIC_SETTINGS: ProjectEpisodicSettings = {
  enabled: true,
  autoEpisodeIntervalMs: 10_000,
  maxMessages: 100,
  maxRetries: 3,
  contextEpisodes: 3,
  similarityWeight: 0.7,
  recencyWeight: 0.3,
};

export const DEFAULT_SEMANTIC_SETTINGS: ProjectSemanticSettings = {
  enabled: true,
  minConfidence: 0.5,
  factsInContext: 8,
  entityResolutionThreshold: 0.88,
  factDedupThreshold: 0.95,
};

export function mergeWithDefaults(
  raw: ProjectSettingsPatch | null | undefined,
): ProjectSettings {
  return {
    episodic: { ...DEFAULT_EPISODIC_SETTINGS, ...(raw?.episodic ?? {}) },
    semantic: { ...DEFAULT_SEMANTIC_SETTINGS, ...(raw?.semantic ?? {}) },
  };
}

import type {
  ProjectEpisodicSettings,
  ProjectSemanticSettings,
  ProjectWorkingSettings,
  ProjectSettings,
  ProjectSettingsPatch,
} from '@memory-soda/types';

export const DEFAULT_EPISODIC_SETTINGS: ProjectEpisodicSettings = {
  enabled: true,
  autoEpisodeIntervalMs: 10_000,
  maxMessages: 100,
  maxRetries: 3,
  episodesInContext: 3,
  recencyWeight: 0.3,
};

export const DEFAULT_SEMANTIC_SETTINGS: ProjectSemanticSettings = {
  enabled: true,
  factsInContext: 5,
  entitySimilarityThreshold: 0.95,
  maxRetries: 3,
  minUserFacts: 2,
  minConfidence: 0.5,
};

export const DEFAULT_WORKING_SETTINGS: ProjectWorkingSettings = {
  autoCompactThreshold: 40,
  messageLimit: 20,
};

export function mergeWithDefaults(
  raw: ProjectSettingsPatch | null | undefined,
): ProjectSettings {
  return {
    episodic: { ...DEFAULT_EPISODIC_SETTINGS, ...(raw?.episodic ?? {}) },
    semantic: { ...DEFAULT_SEMANTIC_SETTINGS, ...(raw?.semantic ?? {}) },
    working: { ...DEFAULT_WORKING_SETTINGS, ...(raw?.working ?? {}) },
  };
}

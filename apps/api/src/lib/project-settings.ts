import type {
  ProjectEpisodicSettings,
  ProjectSettings,
  ProjectSettingsPatch,
} from '@memory-soda/types';

export const DEFAULT_EPISODIC_SETTINGS: ProjectEpisodicSettings = {
  enabled: true,
  maxMessages: 100,
  maxRetries: 3,
  retryDelayMs: 300000,
  contextEpisodes: 3,
  similarityWeight: 0.7,
  recencyWeight: 0.3,
};

export function mergeWithDefaults(
  raw: ProjectSettingsPatch | null | undefined,
): ProjectSettings {
  return {
    episodic: { ...DEFAULT_EPISODIC_SETTINGS, ...(raw?.episodic ?? {}) },
  };
}

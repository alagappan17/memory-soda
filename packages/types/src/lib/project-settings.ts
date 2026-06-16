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

export interface ProjectSettings {
  episodic: ProjectEpisodicSettings;
}

export interface ProjectSettingsPatch {
  episodic?: Partial<ProjectEpisodicSettings>;
}

export function mergeWithDefaults(
  raw: ProjectSettingsPatch | null | undefined,
): ProjectSettings {
  return {
    episodic: { ...DEFAULT_EPISODIC_SETTINGS, ...(raw?.episodic ?? {}) },
  };
}

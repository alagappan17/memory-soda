export type EpisodeStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'deleted' | 'archived';

export interface Episode {
  episodeId: string;
  threadId: string | null;
  dataset: string;
  projectId: string;
  status: EpisodeStatus;
  summary: string | null;
  keyLearnings: string[] | null;
  messageCount: number;
  tokenCount: number | null;
  startedAt: string | null;
  endedAt: string | null;
  processingStartedAt: string | null;
  processingCompletedAt: string | null;
  error: string | null;
  retryCount: number;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface EpisodeWithRelevance extends Episode {
  relevanceScore: number;
}

export interface EpisodeContextItem {
  episodeId: string;
  summary: string;
  keyLearnings: string[];
  startedAt: string;
  endedAt: string;
  relevanceScore: number;
}

export interface EpisodeContext {
  episodes: EpisodeContextItem[] | null;
  episodeCount: number;
}

export interface EpisodesListQuery {
  limit?: number;
  before?: string;
  status?: EpisodeStatus;
}

export interface EpisodesListResponse {
  episodes: Episode[];
  total: number;
  hasMore: boolean;
}

export interface EpisodesSearchResponse {
  episodes: EpisodeWithRelevance[];
}

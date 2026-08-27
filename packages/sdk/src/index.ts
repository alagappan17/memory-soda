export { MemorySoda } from './client.js';
export type {
  MemorySodaConfig,
  ListFactsOptions,
  ListEpisodesOptions,
  WMNothingToCompact,
} from './client.js';

export { ApiError, AuthError, MemorySodaError, NetworkError } from './errors.js';
export type { OnRequest, OnResponse } from './http.js';

export type {
  HealthResponse,
  // Threads
  WMThread,
  WMThreadSettings,
  WMCreateThreadRequest,
  WMCreateThreadResponse,
  WMPatchThreadRequest,
  WMEndThreadResponse,
  WMTokenUsage,
  WMCompactResult,
  // Working memory
  MessageRole,
  WMMessage,
  WMMessageMetadata,
  WMTokenCount,
  WMAddMessageRequest,
  WMAddMessageResponse,
  WMListMessagesQuery,
  WMListMessagesResponse,
  WMPrepareRequest,
  WMPrepareResponse,
  // Recall
  RecallRequest,
  RecallResponse,
  RankedContextGroup,
  // Semantic memory
  EntityType,
  SemanticFact,
  SemanticEntity,
  SemanticFactsResponse,
  // Episodic memory
  Episode,
  EpisodeStatus,
  EpisodeWithRelevance,
  EpisodesListResponse,
  EpisodeContext,
  EpisodeContextItem,
  // Datasets
  DatasetExport,
  DatasetDeletion,
} from '@memory-soda/types';

export { MemorySodaClient } from './client.js';
export type {
  MemorySodaConfig,
  ListThreadsOptions,
  ListThreadsResponse,
} from './client.js';
export type { CallOptions } from './http.js';
export {
  ApiError,
  AuthError,
  MemorySodaError,
  NetworkError,
} from './errors.js';
export type {
  HealthResponse,
  // Thread
  WMThread,
  WMThreadSettings,
  WMCreateThreadRequest,
  WMPatchThreadRequest,
  WMCreateThreadResponse,
  WMEndThreadResponse,
  WMTokenUsage,
  WMThreadStatsResponse,
  WMCompactResult,
  WMCompactSummaryMetadata,
  // Messages
  MessageRole,
  WMMessage,
  WMMessageMetadata,
  WMTokenCount,
  WMAddMessageRequest,
  WMListMessagesQuery,
  WMAddMessageResponse,
  WMListMessagesResponse,
  WMPrepareRequest,
  WMPrepareResponse,
  // Episodic memory
  Episode,
  EpisodeStatus,
  EpisodesListQuery,
  EpisodesListResponse,
  // Episodic context (surfaced in prepare response)
  EpisodeContextItem,
  EpisodeContext,
  // Semantic memory
  SemanticFact,
  SemanticEntity,
  SemanticRelationship,
  SemanticContext,
  SemanticFactsResponse,
  SemanticEntitiesResponse,
  SemanticRelationshipsResponse,
  // Project settings (per-thread overrides)
  ProjectEpisodicSettings,
  ProjectSemanticSettings,
  ProjectWorkingSettings,
  ProjectSettings,
} from '@memory-soda/types';

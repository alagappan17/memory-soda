export { MemorySodaClient } from './client.js';
export type { MemorySodaConfig } from './client.js';
export { ThreadClient } from './thread.js';
export { WorkingMemoryClient } from './working-memory.js';
export { SemanticMemoryClient } from './semantic-memory.js';
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
  // Working Memory
  MessageRole,
  WMMessage,
  WMMessageMetadata,
  WMTokenCount,
  WMAddMessageRequest,
  WMListMessagesQuery,
  WMPrepareRequest,
  WMAddMessageResponse,
  WMListMessagesResponse,
  WMPrepareResponse,
  // Recall
  RecallRequest,
  RecallResponse,
  // Prepare context block
  RankedContextGroup,
  // Episodic context (surfaced in prepare response)
  EpisodeContextItem,
  EpisodeContext,
  // Semantic memory
  EntityType,
  SemanticFact,
  SemanticEntity,
  SemanticContext,
  SemanticFactsResponse,
  SemanticEntitiesResponse,
  SemanticEntityFactsResponse,
} from '@memory-soda/types';

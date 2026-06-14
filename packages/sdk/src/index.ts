export { MemorySodaClient } from './client.js';
export type { MemorySodaConfig } from './client.js';
export { ThreadClient } from './thread.js';
export { WorkingMemoryClient } from './working-memory.js';
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
  // Episodic context (surfaced in prepare response)
  EpisodeContextItem,
  EpisodeContext,
} from '@memory-soda/types';

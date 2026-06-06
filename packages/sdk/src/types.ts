export type {
  HealthResponse,
  // Working Memory
  MessageRole,
  WMThread,
  WMMessage,
  WMMessageMetadata,
  WMTokenCount,
  WMCreateThreadRequest,
  WMPatchThreadRequest,
  WMAddMessageRequest,
  WMListMessagesQuery,
  WMPrepareRequest,
  WMCreateThreadResponse,
  WMAddMessageResponse,
  WMListMessagesResponse,
  WMPrepareResponse,
  WMEndThreadResponse,
  WMTokenUsage,
  WMThreadStatsResponse,
  WMCompactResult,
  WMCompactSummaryMetadata,
} from '@memory-soda/types';

export interface MemorySodaConfig {
  baseUrl: string;
  apiKey: string;
  timeout?: number;
}

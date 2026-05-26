export type {
  HealthResponse,
  Message,
  ExtractedFact,
  EntityType,
  MemoryFact,
  FactClassification,
  MemoryOperationStep,
  AddMemoryResult,
  ContextFact,
  RetrieveMemoryResult,
  GraphAddRequest,
  GraphAddResponse,
  GraphRetrieveRequest,
  GraphRetrieveResponse,
  GraphChatRequest,
  GraphChatResponse,
  GraphChatUsage,
} from '@memory-soda/types';

export interface MemorySodaConfig {
  baseUrl: string;
  apiKey: string;
  timeout?: number;
}

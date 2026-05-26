import type { MemoryMetadata, MemoryRecord, MemorySource } from './memory.js';
import type { ListOptions, RetrievalOptions, RetrievalResult } from './retrieval.js';

export interface StoreMemoryRequest {
  userId: string;
  content: string;
  source?: MemorySource;
  metadata?: MemoryMetadata;
}

export interface StoreMemoryResponse {
  memory: MemoryRecord;
}

export interface RetrieveMemoryRequest {
  userId: string;
  query: string;
  options?: RetrievalOptions;
}

export interface RetrieveMemoryResponse {
  results: RetrievalResult[];
}

export interface ListMemoriesRequest extends ListOptions {
  userId: string;
}

export interface ListMemoriesResponse {
  memories: MemoryRecord[];
  total: number;
}

export interface DeleteMemoryResponse {
  success: boolean;
}

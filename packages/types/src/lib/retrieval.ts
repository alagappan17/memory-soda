import type { MemoryRecord } from './memory.js';

export interface RetrievalOptions {
  limit?: number;
  threshold?: number;
  includeMetadata?: boolean;
}

export interface ListOptions {
  limit?: number;
  offset?: number;
}

export interface RetrievalResult {
  memory: MemoryRecord;
  score: number;
}

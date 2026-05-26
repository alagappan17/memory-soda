export type MemorySource = 'USER' | 'AGENT' | 'SYSTEM';

export interface MemoryMetadata {
  [key: string]: unknown;
}

export interface MemoryRecord {
  id: string;
  userId: string;
  content: string;
  source: MemorySource;
  metadata: MemoryMetadata;
  createdAt: string;
  updatedAt: string;
}

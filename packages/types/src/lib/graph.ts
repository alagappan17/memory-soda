export type EntityType = 'User' | 'Person' | 'Organization' | 'Place' | 'Topic' | 'Concept' | 'Value';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface ExtractedFact {
  subject: string;
  subjectType: EntityType;
  predicate: string;
  object: string;
  objectType: EntityType;
  confidence: number;
}

export interface MemoryFact {
  id: string;
  userId: string;
  text: string;
  predicate: string;
  subjectName: string;
  subjectType: EntityType;
  objectName: string;
  objectType: EntityType;
  confidence: number;
  validAt: string;
  invalidAt: string | null;
}

export type FactClassification = 'NEW' | 'CONTRADICTION' | 'REINFORCEMENT';

export interface MemoryOperationStep {
  type: 'extract' | 'resolve' | 'classify' | 'create' | 'update' | 'invalidate' | 'skip' | 'retrieve';
  fact?: ExtractedFact;
  existingFact?: MemoryFact;
  classification?: FactClassification;
  message: string;
}

export interface AddMemoryResult {
  userId: string;
  factsExtracted: number;
  factsCreated: number;
  factsUpdated: number;
  factsInvalidated: number;
  log: MemoryOperationStep[];
}

export interface ContextFact {
  text: string;
  predicate: string;
  subject: string;
  object: string;
  confidence: number;
  validAt: string;
  score?: number;
}

export interface RetrieveMemoryResult {
  facts: ContextFact[];
  contextText: string;
}

// API request/response types

export interface GraphAddRequest {
  userId: string;
  messages: Message[];
}

export interface GraphAddResponse {
  result: AddMemoryResult;
}

export interface GraphRetrieveRequest {
  userId: string;
  query: string;
  limit?: number;
}

export interface GraphRetrieveResponse {
  result: RetrieveMemoryResult;
}

export interface GraphChatRequest {
  userId: string;
  messages: Message[];
  systemPromptTemplate?: string;
}

export interface GraphChatUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface GraphChatResponse {
  message: string;
  systemPrompt: string;
  memoryContext: ContextFact[];
  memoryLog: MemoryOperationStep[];
  usage: GraphChatUsage;
  latencyMs: number;
}

// Project types

export interface Project {
  id: string;
  name: string;
  createdAt: string;
}

export interface CreateProjectRequest {
  name: string;
}

export interface CreateProjectResponse {
  project: Project;
}

export interface ListProjectsResponse {
  projects: Project[];
}

// API key types

export interface ApiKey {
  id: string;
  name: string;
  keyPreview: string;
  projectId: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface CreateApiKeyRequest {
  name: string;
  projectId: string;
}

export interface CreateApiKeyResponse {
  apiKey: ApiKey;
  key: string; // full key, shown only once
}

export interface ListApiKeysResponse {
  apiKeys: ApiKey[];
}

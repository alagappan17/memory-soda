// ── Thread ────────────────────────────────────────────────────────────────────

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface WMThread {
  threadId: string;
  userId: string;
  tags: string[];
  messageCount: number;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  lastActivityAt: string;
  endedAt: string | null;
}

export interface WMMessageMetadata {
  stopReason?: string;
  agentName?: string;
}

export interface WMMessage {
  messageId: string;
  threadId: string;
  role: MessageRole;
  content: string;
  sequenceNumber: number;
  tokenCount: WMTokenCount | null;
  model: string | null;
  latencyMs: number | null;
  metadata: WMMessageMetadata | null;
  createdAt: string;
}

export interface WMTokenCount {
  input?: number;
  output?: number;
  total?: number;
}

// ── Request bodies ────────────────────────────────────────────────────────────

export interface WMCreateThreadRequest {
  userId?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface WMPatchThreadRequest {
  metadata: Record<string, unknown>;
}

export interface WMAddMessageRequest {
  role: MessageRole;
  content: string;
  tokenCount?: WMTokenCount;
  model?: string;
  latencyMs?: number;
  metadata?: WMMessageMetadata;
}

export interface WMListMessagesQuery {
  limit?: number;
  before?: number;
  order?: 'asc' | 'desc';
}

export interface WMPrepareRequest {
  messageLimit?: number;
}

// ── Response shapes ───────────────────────────────────────────────────────────

export interface WMCreateThreadResponse {
  threadId: string;
  userId: string;
  createdAt: string;
}

export interface WMAddMessageResponse {
  messageId: string;
  threadId: string;
  sequenceNumber: number;
  role: MessageRole;
  createdAt: string;
}

export interface WMListMessagesResponse {
  messages: WMMessage[];
  total: number;
  hasMore: boolean;
}

export interface WMPrepareResponse {
  threadId: string;
  messages: { role: string; content: string }[];
  messageCount: number;
  truncated: boolean;
}

export interface WMEndThreadResponse {
  threadId: string;
  endedAt: string;
}

export interface WMTokenUsage {
  totalInput: number;
  totalOutput: number;
  totalTokens: number;
  averagePerMessage: number;
}

export interface WMThreadStatsResponse {
  threadId: string;
  messageCount: number;
  tokenUsage: WMTokenUsage | null;
  sessionDuration: { ms: number; seconds: number } | null;
  createdAt: string;
  lastActivityAt: string;
}

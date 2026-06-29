export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

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
  compactedAt: string | null;
  createdAt: string;
}

export interface WMTokenCount {
  input?: number;
  output?: number;
  total?: number;
}

// ── Request bodies ────────────────────────────────────────────────────────────

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

// ── Response shapes ───────────────────────────────────────────────────────────

export interface WMAddMessageResponse {
  messageId: string;
  threadId: string;
  sequenceNumber: number;
  role: MessageRole;
  createdAt: string;
  compacted: boolean;
}

export interface WMListMessagesResponse {
  messages: WMMessage[];
  total: number;
  hasMore: boolean;
}


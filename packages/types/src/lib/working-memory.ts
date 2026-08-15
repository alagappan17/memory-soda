import type { RecallResponse } from './prepare.js';

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
  tokens: WMTokenCount | null;
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
  tokens?: WMTokenCount;
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

// ── Chat ──────────────────────────────────────────────────────────────────────
//
// The chat route is a demo/playground endpoint: the server runs the LLM turn
// itself. SDK consumers integrating their own LLM should use prepare() +
// recall() (or prepareAndRecall()) instead.

export interface WMChatRequest {
  content: string;
  systemPrompt?: string;
  messageLimit?: number;
  /** When true, the response includes the full recall payload injected into the LLM. */
  verbose?: boolean;
}

export interface WMChatUserMessage {
  messageId: string;
  sequenceNumber: number;
  role: MessageRole;
  createdAt: string;
}

export interface WMChatAssistantMessage extends WMChatUserMessage {
  content: string;
}

/** Working-memory stats for the turn (thread state fed to the LLM). */
export interface WMChatPrepareSummary {
  messageCount: number;
  truncated: boolean;
  compacted: boolean;
}

/** Long-term-memory stats for the turn (what recall() contributed). */
export interface WMChatRecallSummary {
  episodeCount: number;
  factCount: number;
  hasContext: boolean;
  hasSynthesis: boolean;
}

export interface WMChatResponse {
  userMessage: WMChatUserMessage;
  assistantMessage: WMChatAssistantMessage;
  compacted: boolean;
  prepare: WMChatPrepareSummary;
  recallSummary: WMChatRecallSummary;
  /** Present only when the request set verbose: true. */
  recall?: RecallResponse;
}


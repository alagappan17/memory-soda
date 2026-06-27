import type { EpisodeContext } from './episodic-memory.js';
import type { SemanticContext } from './semantic-memory.js';

export interface WMPrepareRequest {
  messageLimit?: number;
  query?: string;
}

export interface WMPrepareResponse {
  threadId: string;
  messages: { role: string; content: string }[];
  episodes: EpisodeContext | null;
  facts: SemanticContext | null;
  messageCount: number;
  truncated: boolean;
  compacted: boolean;
  /** Present when messageLimit < autoCompactThreshold — callers risk a context gap between the compact summary and the retrieved tail. */
  warning?: string;
}

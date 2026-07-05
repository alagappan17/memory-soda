import type { EpisodeContext } from './episodic-memory.js';
import type { SemanticFact } from './semantic-memory.js';

/**
 * A group of facts for a single anchor entity, sorted by relevance. The anchor
 * is derived: the object when it is an entity, else the subject.
 */
export interface RankedContextGroup {
  entityName: string;
  facts: {
    subject: string;
    predicate: string;
    object: string;
    sourceQuote: string | null;
    validAt: string;
    validUntil: string | null;
    relevanceScore: number;
  }[];
  /** max(fact.relevanceScore) in the group — used to order groups. */
  groupRelevance: number;
}

export interface WMPrepareRequest {
  messageLimit?: number;
  query?: string;
  /**
   * Opt-in extras:
   * - `'episodes'` — include episodic (cross-thread) context. Off by default.
   * - `'synthesis'` — include an LLM-written prose summary of the context. Off by default.
   * - `'raw'` — include the structured `facts` and `groups` arrays alongside the
   *   rendered string. Off by default.
   */
  include?: ('episodes' | 'synthesis' | 'raw')[];
}

export interface WMPrepareResponse {
  threadId: string;
  messages: { role: string; content: string }[];
  /** Rendered, prompt-ready context block (the primary output). Empty string if no facts. */
  context: string;
  /** Populated only when `include: ['synthesis']`. */
  synthesis: string | null;
  /** Populated only when `include: ['raw']`. */
  facts: SemanticFact[] | null;
  /** Populated only when `include: ['raw']`. */
  groups: RankedContextGroup[] | null;
  /** Populated only when `include: ['episodes']`. */
  episodes: EpisodeContext | null;
  messageCount: number;
  truncated: boolean;
  compacted: boolean;
  warning?: string;
}

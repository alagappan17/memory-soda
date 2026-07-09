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

/**
 * prepare() is pure working memory: thread state needed to continue the
 * conversation. No embedding or LLM calls — long-term memory lives in recall().
 */
export interface WMPrepareRequest {
  messageLimit?: number;
}

export interface WMPrepareResponse {
  threadId: string;
  /** The dataset this thread belongs to — handy for a follow-up recall(). */
  dataset: string;
  messages: { role: string; content: string }[];
  messageCount: number;
  truncated: boolean;
  compacted: boolean;
  warning?: string;
}

// ── Recall (long-term memory retrieval) ────────────────────────────────────────

/**
 * recall() fetches long-term memory for a dataset — no thread required. Facts
 * always drive the rendered `context`; episodes/synthesis/raw are opt-in extras.
 */
export interface RecallRequest {
  /** The memory store to recall from (formerly userId). */
  dataset: string;
  /** Retrieval query; without it, the most recent facts are returned. */
  query?: string;
  /**
   * Opt-in extras:
   * - `'episodes'` — include episodic (cross-thread) context.
   * - `'synthesis'` — include an LLM-written prose summary of the context.
   * - `'raw'` — include the structured `facts` and `groups` arrays.
   */
  include?: ('episodes' | 'synthesis' | 'raw')[];
  /** Max facts in context (defaults to the project's factsInContext setting). */
  limit?: number;
  /** Confidence floor for this call (defaults to the project's retrievalMinConfidence). */
  minConfidence?: number;
  /** Point-in-time recall: facts that were true at this instant (ISO). */
  asOf?: string;
}

export interface RecallResponse {
  /** Rendered, prompt-ready context block. Empty string if no facts. */
  context: string;
  /** Populated only when `include: ['synthesis']`. */
  synthesis: string | null;
  /** Populated only when `include: ['raw']`. */
  facts: SemanticFact[] | null;
  /** Populated only when `include: ['raw']`. */
  groups: RankedContextGroup[] | null;
  /** Populated only when `include: ['episodes']`. */
  episodes: EpisodeContext | null;
  factCount: number;
}

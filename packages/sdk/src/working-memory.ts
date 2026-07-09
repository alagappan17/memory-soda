import { request } from './http.js';
import type {
  WMAddMessageRequest,
  WMAddMessageResponse,
  WMListMessagesQuery,
  WMListMessagesResponse,
  WMPrepareRequest,
  WMPrepareResponse,
  WMCompactResult,
  WMCreateThreadRequest,
  WMThreadStatsResponse,
} from '@memory-soda/types';
import type { ThreadClient } from './thread.js';

const BASE = '/v1/memory/working';

export class WorkingMemoryClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly signal: () => AbortSignal,
    private readonly threads: ThreadClient,
  ) {}

  /**
   * Append a message to a thread. `sequenceNumber` is assigned automatically.
   *
   * @param threadId - The thread to append to.
   * @param opts.role - `user`, `assistant`, `system`, or `tool`.
   * @param opts.content - The message text.
   * @param opts.tokenCount - Optional token breakdown for the message.
   * @param opts.model - Model ID used to generate the message (for assistant turns).
   * @param opts.latencyMs - Time in ms the model took to respond (for assistant turns).
   * @param opts.metadata - Optional structured metadata (`stopReason`, `agentName`).
   * @returns The saved message ID, sequence number, role, and creation timestamp.
   */
  addMessage(
    threadId: string,
    opts: WMAddMessageRequest,
  ): Promise<WMAddMessageResponse> {
    return request(
      this.baseUrl,
      this.apiKey,
      `${BASE}/threads/${threadId}/messages`,
      {
        method: 'POST',
        body: opts,
        signal: this.signal(),
      },
    );
  }

  /**
   * List messages with cursor-based pagination.
   *
   * @param threadId - The thread to query.
   * @param opts.limit - Max messages to return (1–100, default 20).
   * @param opts.before - Return messages with sequenceNumber less than this value (cursor).
   * @param opts.order - Sort direction (`asc` or `desc`, default `asc`).
   * @returns Paginated message list with `total` count and `hasMore` flag.
   */
  listMessages(
    threadId: string,
    opts: WMListMessagesQuery = {},
  ): Promise<WMListMessagesResponse> {
    const params = new URLSearchParams();
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts.before !== undefined) params.set('before', String(opts.before));
    if (opts.order !== undefined) params.set('order', opts.order);
    const qs = params.size > 0 ? `?${params}` : '';
    return request(
      this.baseUrl,
      this.apiKey,
      `${BASE}/threads/${threadId}/messages${qs}`,
      {
        signal: this.signal(),
      },
    );
  }

  /**
   * Fetch the last N messages formatted for LLM injection. **Call this before every LLM turn.**
   *
   * The result is a `{ role, content }[]` array ready to pass directly to any chat-completion API.
   *
   * @param threadId - The thread to prepare.
   * @param opts.messageLimit - Number of recent messages to include (default 20, max 100).
   *   When compaction is enabled (`autoCompactThreshold` is set), set `messageLimit` >=
   *   `autoCompactThreshold` so that all messages since the last compact summary are included.
   *   If `messageLimit` is smaller, a `warning` field is returned in the response.
   * @returns Message array, count, `truncated` flag (older messages dropped), and an optional
   *   `warning` when `messageLimit < autoCompactThreshold`.
   */
  prepare(
    threadId: string,
    opts: WMPrepareRequest = {},
  ): Promise<WMPrepareResponse> {
    return request(
      this.baseUrl,
      this.apiKey,
      `${BASE}/threads/${threadId}/prepare`,
      {
        method: 'POST',
        body: opts,
        signal: this.signal(),
      },
    );
  }

  /**
   * Compact a thread by summarizing its un-compacted messages via LLM.
   * Uses a rolling strategy — each call folds all history into a single active summary.
   * Auto-compact fires automatically after `addMessage` when `autoCompactThreshold` is set.
   *
   * @param threadId - The thread to compact.
   * @returns Compaction result including summary message ID and the compacted sequence range.
   */
  compact(threadId: string): Promise<WMCompactResult> {
    return request(
      this.baseUrl,
      this.apiKey,
      `${BASE}/threads/${threadId}/compact`,
      {
        method: 'POST',
        signal: this.signal(),
      },
    );
  }

  /**
   * Token usage and session duration stats for a thread.
   *
   * @param threadId - The thread to query.
   * @returns Aggregated input/output token totals, average per message, and session duration.
   */
  getThreadStats(threadId: string): Promise<WMThreadStatsResponse> {
    return request(
      this.baseUrl,
      this.apiKey,
      `${BASE}/threads/${threadId}/stats`,
      {
        signal: this.signal(),
      },
    );
  }

  /**
   * Convenience wrapper: create a thread, add the first message, and call `prepare` — all in one sequence.
   * Use this for the opening turn of a new conversation to avoid three separate awaits.
   *
   * @param opts.dataset - Stable user identifier. Auto-generated if omitted.
   * @param opts.firstMessage - The first message to add (typically a `user` turn).
   * @param opts.tags - Optional thread labels.
   * @param opts.metadata - Optional thread metadata.
   * @param opts.autoCompactThreshold - Auto-compact after this many un-compacted messages.
   * @param opts.settings - Optional per-thread settings overrides (e.g. episodic).
   * @returns The new `threadId` and the `prepare` result ready for the first LLM call.
   */
  async startConversation(opts: {
    dataset?: string;
    firstMessage: WMAddMessageRequest;
    tags?: string[];
    metadata?: Record<string, unknown>;
    autoCompactThreshold?: number;
    settings?: WMCreateThreadRequest['settings'];
  }): Promise<{ threadId: string; prepare: WMPrepareResponse }> {
    const thread = await this.threads.create({
      dataset: opts.dataset,
      tags: opts.tags,
      metadata: opts.metadata,
      autoCompactThreshold: opts.autoCompactThreshold,
      settings: opts.settings,
    });
    await this.addMessage(thread.threadId, opts.firstMessage);
    const prepare = await this.prepare(thread.threadId);
    return { threadId: thread.threadId, prepare };
  }
}


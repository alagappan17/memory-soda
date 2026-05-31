import { request } from './http.js';
import type {
  WMThread,
  WMMessage,
  WMCreateThreadRequest,
  WMCreateThreadResponse,
  WMPatchThreadRequest,
  WMAddMessageRequest,
  WMAddMessageResponse,
  WMListMessagesQuery,
  WMListMessagesResponse,
  WMPrepareRequest,
  WMPrepareResponse,
  WMEndThreadResponse,
  WMThreadStatsResponse,
} from './types.js';

const BASE = '/v1/memory/working';

export class WorkingMemoryClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly signal: () => AbortSignal,
  ) {}

  /**
   * Create a new conversation thread.
   *
   * @param opts.userId - Stable identifier for the user. Auto-generated (Reddit-style) if omitted.
   * @param opts.tags - Optional labels for filtering threads in the dashboard.
   * @param opts.metadata - Arbitrary key-value data attached to the thread.
   * @returns The new thread ID, userId, and creation timestamp.
   */
  createThread(opts: WMCreateThreadRequest): Promise<WMCreateThreadResponse> {
    return request(this.baseUrl, this.apiKey, `${BASE}/threads`, {
      method: 'POST',
      body: opts,
      signal: this.signal(),
    });
  }

  /**
   * Fetch a thread by ID.
   *
   * @param threadId - The thread ID returned from {@link createThread}.
   * @returns Full thread object including message count and metadata.
   * @throws If the thread does not exist or was created with a different API key.
   */
  getThread(threadId: string): Promise<WMThread> {
    return request(this.baseUrl, this.apiKey, `${BASE}/threads/${threadId}`, {
      signal: this.signal(),
    });
  }

  /**
   * Merge-update a thread's metadata. Existing keys are preserved; only the provided keys are overwritten.
   *
   * @param threadId - The thread to update.
   * @param opts.metadata - Key-value pairs to merge into the thread's existing metadata.
   * @returns The updated thread.
   */
  updateThread(threadId: string, opts: WMPatchThreadRequest): Promise<WMThread> {
    return request(this.baseUrl, this.apiKey, `${BASE}/threads/${threadId}`, {
      method: 'PATCH',
      body: opts,
      signal: this.signal(),
    });
  }

  /**
   * Mark a thread as ended. Sets `endedAt`; the thread becomes read-only after this call.
   *
   * @param threadId - The thread to end.
   * @returns The thread ID and the `endedAt` timestamp.
   */
  endThread(threadId: string): Promise<WMEndThreadResponse> {
    return request(this.baseUrl, this.apiKey, `${BASE}/threads/${threadId}/end`, {
      method: 'POST',
      signal: this.signal(),
    });
  }

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
  addMessage(threadId: string, opts: WMAddMessageRequest): Promise<WMAddMessageResponse> {
    return request(this.baseUrl, this.apiKey, `${BASE}/threads/${threadId}/messages`, {
      method: 'POST',
      body: opts,
      signal: this.signal(),
    });
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
  listMessages(threadId: string, opts: WMListMessagesQuery = {}): Promise<WMListMessagesResponse> {
    const params = new URLSearchParams();
    if (opts.limit  !== undefined) params.set('limit',  String(opts.limit));
    if (opts.before !== undefined) params.set('before', String(opts.before));
    if (opts.order  !== undefined) params.set('order',  opts.order);
    const qs = params.size > 0 ? `?${params}` : '';
    return request(this.baseUrl, this.apiKey, `${BASE}/threads/${threadId}/messages${qs}`, {
      signal: this.signal(),
    });
  }

  /**
   * Fetch the last N messages formatted for LLM injection. **Call this before every LLM turn.**
   *
   * The result is a `{ role, content }[]` array ready to pass directly to any chat-completion API.
   * Responses are cached server-side for 5 seconds per thread.
   *
   * @param threadId - The thread to prepare.
   * @param opts.messageLimit - Number of recent messages to include (default 20, max 100).
   * @returns Message array, count, and a `truncated` flag indicating whether older messages were dropped.
   */
  prepare(threadId: string, opts: WMPrepareRequest = {}): Promise<WMPrepareResponse> {
    return request(this.baseUrl, this.apiKey, `${BASE}/threads/${threadId}/prepare`, {
      method: 'POST',
      body: opts,
      signal: this.signal(),
    });
  }

  /**
   * Token usage and session duration stats for a thread.
   *
   * @param threadId - The thread to query.
   * @returns Aggregated input/output token totals, average per message, and session duration.
   */
  getThreadStats(threadId: string): Promise<WMThreadStatsResponse> {
    return request(this.baseUrl, this.apiKey, `${BASE}/threads/${threadId}/stats`, {
      signal: this.signal(),
    });
  }

  /**
   * Convenience wrapper: create a thread, add the first message, and call `prepare` — all in one round-trip sequence.
   * Use this for the opening turn of a new conversation to avoid three separate awaits.
   *
   * @param opts.userId - Stable user identifier. Auto-generated if omitted.
   * @param opts.firstMessage - The first message to add (typically a `user` turn).
   * @param opts.tags - Optional thread labels.
   * @param opts.metadata - Optional thread metadata.
   * @returns The new `threadId` and the `prepare` result ready for the first LLM call.
   */
  async startConversation(opts: {
    userId?: string;
    firstMessage: WMAddMessageRequest;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<{ threadId: string; prepare: WMPrepareResponse }> {
    const thread = await this.createThread({
      userId: opts.userId,
      tags: opts.tags,
      metadata: opts.metadata,
    });
    await this.addMessage(thread.threadId, opts.firstMessage);
    const prepare = await this.prepare(thread.threadId);
    return { threadId: thread.threadId, prepare };
  }
}

export type { WMMessage, WMThread };

import { request } from './http.js';
import type {
  WMThread,
  WMCreateThreadRequest,
  WMCreateThreadResponse,
  WMPatchThreadRequest,
  WMEndThreadResponse,
} from '@memory-soda/types';

const BASE = '/v1/threads';

export class ThreadClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly signal: () => AbortSignal,
  ) {}

  /**
   * Create a new conversation thread.
   *
   * @param opts.dataset - Stable identifier for the user. Auto-generated if omitted.
   * @param opts.tags - Optional labels for filtering threads.
   * @param opts.metadata - Arbitrary key-value data attached to the thread.
   * @param opts.autoCompactThreshold - Auto-compact after this many un-compacted messages.
   * @param opts.settings.episodic - Override project-level episodic memory settings for this thread.
   * @returns The new thread ID, dataset, creation timestamp, and resolved settings.
   */
  create(opts: WMCreateThreadRequest): Promise<WMCreateThreadResponse> {
    return request(this.baseUrl, this.apiKey, BASE, {
      method: 'POST',
      body: opts,
      signal: this.signal(),
    });
  }

  /**
   * Fetch a thread by ID.
   *
   * @param threadId - The thread ID returned from {@link create}.
   * @returns Full thread object including settings, message count, and metadata.
   * @throws If the thread does not exist or belongs to a different project.
   */
  get(threadId: string): Promise<WMThread> {
    return request(this.baseUrl, this.apiKey, `${BASE}/${threadId}`, {
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
  update(threadId: string, opts: WMPatchThreadRequest): Promise<WMThread> {
    return request(this.baseUrl, this.apiKey, `${BASE}/${threadId}`, {
      method: 'PATCH',
      body: opts,
      signal: this.signal(),
    });
  }

  /**
   * Trigger episodic memory extraction for the thread. The thread remains writable after this call.
   *
   * @param threadId - The thread to end.
   * @returns `{ threadId, episodeQueued: true }`.
   */
  end(threadId: string): Promise<WMEndThreadResponse> {
    return request(this.baseUrl, this.apiKey, `${BASE}/${threadId}/end`, {
      method: 'POST',
      signal: this.signal(),
    });
  }
}

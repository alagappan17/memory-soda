import type { ProjectEpisodicSettings } from './project-settings.js';

export interface WMThreadSettings {
  autoCompactThreshold: number | null;
  episodic: ProjectEpisodicSettings;
}

export interface WMThread {
  threadId: string;
  dataset: string;
  tags: string[];
  metadata: Record<string, unknown> | null;
  createdAt: string;
  lastActivityAt: string;
  settings: WMThreadSettings;
  lastCompactedAt: string | null;
  lastCompactedSequence: number;
}

export interface WMCreateThreadRequest {
  dataset?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  autoCompactThreshold?: number;
  settings?: {
    /** Overrides project defaults for this thread. Omit to use project defaults. */
    episodic?: Partial<ProjectEpisodicSettings>;
  };
}

export interface WMPatchThreadRequest {
  metadata: Record<string, unknown>;
}

export interface WMCreateThreadResponse {
  threadId: string;
  /** The project the API key belongs to — handy for dashboard-side lookups. */
  projectId: string;
  dataset: string;
  createdAt: string;
  settings: WMThreadSettings;
}

export interface WMEndThreadResponse {
  threadId: string;
  episodeQueued: boolean;
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

export interface WMCompactResult {
  threadId: string;
  summaryMessageId: string;
  compactedCount: number;
  fromSequence: number;
  toSequence: number;
}

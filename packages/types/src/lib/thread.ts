import type {
  ProjectEpisodicSettings,
  ProjectSemanticSettings,
  ProjectWorkingSettings,
} from './project-settings.js';

export interface WMThreadSettings {
  autoCompactThreshold: number | null;
  episodic: ProjectEpisodicSettings;
  semantic: ProjectSemanticSettings;
  working: ProjectWorkingSettings;
}

export interface WMThread {
  threadId: string;
  userId: string;
  tags: string[];
  messageCount: number;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  lastActivityAt: string;
  settings: WMThreadSettings;
  lastCompactedAt: string | null;
  lastCompactedSequence: number;
}

export interface WMCreateThreadRequest {
  userId?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  autoCompactThreshold?: number;
  settings?: {
    /** Overrides project defaults for this thread. Omit to use project defaults. */
    episodic?: Partial<ProjectEpisodicSettings>;
    semantic?: Partial<ProjectSemanticSettings>;
    working?: Partial<ProjectWorkingSettings>;
  };
}

export interface WMPatchThreadRequest {
  metadata: Record<string, unknown>;
}

export interface WMCreateThreadResponse {
  threadId: string;
  projectId: string;
  userId: string;
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

export interface WMCompactSummaryMetadata {
  type: 'compact_summary';
  compactedRange: {
    fromSeq: number;
    toSeq: number;
    count: number;
  };
}

export interface WMCompactResult {
  threadId: string;
  summaryMessageId: string;
  compactedCount: number;
  fromSequence: number;
  toSequence: number;
}

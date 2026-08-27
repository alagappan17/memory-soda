/**
 * Whole-dataset operations. A dataset usually maps to one person, which is why
 * these two exist: everything held about them, and none of it.
 */

export interface DatasetExportMessage {
  role: string;
  content: string;
  createdAt: string;
}

export interface DatasetExportThread {
  threadId: string;
  tags: string[];
  createdAt: string;
  messages: DatasetExportMessage[];
}

export interface DatasetExportEpisode {
  episodeId: string;
  summary: string | null;
  keyLearnings: string[] | null;
  startedAt: string | null;
  endedAt: string | null;
}

export interface DatasetExportFact {
  factId: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  sourceQuote: string | null;
  validAt: string;
  validUntil: string | null;
  invalidAt: string | null;
}

export interface DatasetExport {
  dataset: string;
  exportedAt: string;
  threads: DatasetExportThread[];
  episodes: DatasetExportEpisode[];
  facts: DatasetExportFact[];
  entities: { name: string; type: string }[];
}

export interface DatasetDeletion {
  dataset: string;
  deleted: {
    threads: number;
    episodes: number;
    facts: number;
    entities: number;
  };
}

/** One dataset as the dashboard lists it. */
export interface DatasetSummary {
  dataset: string;
  threadCount: number;
  factCount: number;
  lastActivityAt: string | null;
}

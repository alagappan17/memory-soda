import { eq, and, sql, desc, lt } from 'drizzle-orm';
import { generateUserId } from '../lib/generate-user-id.js';
import { db } from '../db/postgres.js';
import { threads } from '../db/schema.js';
import {
  getProjectEpisodicSettings,
  createPendingEpisode,
  processEpisode,
} from './episodic-memory.service.js';
import { getProjectSettings } from './project-settings.service.js';
import type {
  ProjectEpisodicSettings,
  ProjectSemanticSettings,
  ProjectWorkingSettings,
} from '@memory-soda/types';

// ── Internal type ─────────────────────────────────────────────────────────────

export interface Thread {
  threadId: string;
  userId: string;
  projectId: string;
  tags: string[];
  messageCount: number;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  autoCompactThreshold: number | null;
  episodicSettings: ProjectEpisodicSettings | null;
  semanticSettings: ProjectSemanticSettings | null;
  workingSettings: ProjectWorkingSettings | null;
  lastCompactedAt: string | null;
  lastCompactedSequence: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function rowToThread(row: typeof threads.$inferSelect): Thread {
  return {
    threadId: row.id,
    userId: row.userId,
    projectId: row.projectId,
    tags: row.tags ?? [],
    messageCount: row.messageCount,
    metadata: row.metadata as Record<string, unknown> | null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastActivityAt: row.lastActivityAt.toISOString(),
    autoCompactThreshold: row.autoCompactThreshold ?? null,
    episodicSettings:
      (row.episodicSettings as ProjectEpisodicSettings | null) ?? null,
    semanticSettings:
      (row.semanticSettings as ProjectSemanticSettings | null) ?? null,
    workingSettings:
      (row.workingSettings as ProjectWorkingSettings | null) ?? null,
    lastCompactedAt: row.lastCompactedAt?.toISOString() ?? null,
    lastCompactedSequence: row.lastCompactedSequence,
  };
}

// ── Thread operations ─────────────────────────────────────────────────────────

export async function createThread(
  projectId: string,
  userId: string | null | undefined,
  tags?: string[],
  metadata?: Record<string, unknown>,
  autoCompactThreshold?: number,
  overrides?: {
    episodic?: Partial<ProjectEpisodicSettings>;
    semantic?: Partial<ProjectSemanticSettings>;
    working?: Partial<ProjectWorkingSettings>;
  },
): Promise<Thread> {
  const projectSettings = await getProjectSettings(projectId);

  // Top-level autoCompactThreshold is a shorthand for working.autoCompactThreshold.
  const workingOverride: Partial<ProjectWorkingSettings> = {
    ...(overrides?.working ?? {}),
    ...(autoCompactThreshold !== undefined ? { autoCompactThreshold } : {}),
  };

  const resolvedEpisodic: ProjectEpisodicSettings = {
    ...projectSettings.episodic,
    ...(overrides?.episodic ?? {}),
  };
  const resolvedSemantic: ProjectSemanticSettings = {
    ...projectSettings.semantic,
    ...(overrides?.semantic ?? {}),
  };
  const resolvedWorking: ProjectWorkingSettings = {
    ...projectSettings.working,
    ...workingOverride,
  };

  const [row] = await db
    .insert(threads)
    .values({
      userId: userId || generateUserId(),
      projectId,
      tags: tags ?? [],
      metadata: metadata ?? null,
      autoCompactThreshold: resolvedWorking.autoCompactThreshold,
      episodicSettings: resolvedEpisodic,
      semanticSettings: resolvedSemantic,
      workingSettings: resolvedWorking,
    })
    .returning();
  return rowToThread(row!);
}

export async function listThreadsByProject(
  projectId: string,
  opts: { userId?: string; limit: number; cursor?: string },
): Promise<{ threads: Thread[]; hasMore: boolean; nextCursor: string | null }> {
  const conditions = [eq(threads.projectId, projectId)];
  if (opts.userId) conditions.push(eq(threads.userId, opts.userId));
  if (opts.cursor)
    conditions.push(lt(threads.lastActivityAt, new Date(opts.cursor)));

  const rows = await db
    .select()
    .from(threads)
    .where(and(...conditions))
    .orderBy(desc(threads.lastActivityAt))
    .limit(opts.limit + 1);

  const hasMore = rows.length > opts.limit;
  const page = rows.slice(0, opts.limit);
  const last = page[page.length - 1];
  return {
    threads: page.map(rowToThread),
    hasMore,
    nextCursor: hasMore && last ? last.lastActivityAt.toISOString() : null,
  };
}

export async function getThread(
  threadId: string,
  projectId: string,
): Promise<Thread | null> {
  const [row] = await db
    .select()
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.projectId, projectId)));
  return row ? rowToThread(row) : null;
}

export async function updateThreadMetadata(
  threadId: string,
  projectId: string,
  metadata: Record<string, unknown>,
): Promise<Thread | null> {
  const [row] = await db
    .update(threads)
    .set({
      metadata: sql`COALESCE(${threads.metadata}, '{}'::jsonb) || ${JSON.stringify(metadata)}::jsonb`,
      updatedAt: new Date(),
    })
    .where(and(eq(threads.id, threadId), eq(threads.projectId, projectId)))
    .returning();
  if (!row) return null;
  return rowToThread(row);
}

/**
 * Threads never terminate — "end" marks a natural break point and triggers
 * episodic extraction. The thread stays writable and the user can return to it.
 * The pending episode row is created synchronously so the trigger survives a
 * crash; the LLM extraction itself runs async.
 */
export async function endThread(
  threadId: string,
  projectId: string,
): Promise<{ thread: Thread; episodeQueued: boolean } | null> {
  const [row] = await db
    .select()
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.projectId, projectId)));
  if (!row) return null;

  const thread = rowToThread(row);
  const settings =
    thread.episodicSettings ?? (await getProjectEpisodicSettings(projectId));
  if (!settings.enabled) {
    return { thread, episodeQueued: false };
  }

  const episode = await createPendingEpisode({
    threadId,
    userId: row.userId,
    projectId,
    messageCount: row.messageCount,
    tokenCount: null,
    startedAt: row.createdAt,
    endedAt: new Date(),
  });

  processEpisode(episode.id).catch((err) => {
    console.error('[episodic] processEpisode failed:', err);
  });

  return { thread, episodeQueued: true };
}

import { eq, and, sql } from 'drizzle-orm';
import { generateUserId } from '../lib/generate-user-id.js';
import { db } from '../db/postgres.js';
import { threads } from '../db/schema.js';
import {
  getProjectEpisodicSettings,
  createPendingEpisode,
  processEpisode,
} from './episodic-memory.service.js';
import type { ProjectEpisodicSettings } from '@memory-soda/types';

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
  episodicOverride?: Partial<ProjectEpisodicSettings>,
): Promise<Thread> {
  const projectSettings = await getProjectEpisodicSettings(projectId);
  const resolvedEpisodic: ProjectEpisodicSettings = episodicOverride
    ? { ...projectSettings, ...episodicOverride }
    : projectSettings;

  const [row] = await db
    .insert(threads)
    .values({
      userId: userId || generateUserId(),
      projectId,
      tags: tags ?? [],
      metadata: metadata ?? null,
      autoCompactThreshold: autoCompactThreshold ?? null,
      episodicSettings: resolvedEpisodic,
    })
    .returning();
  return rowToThread(row!);
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

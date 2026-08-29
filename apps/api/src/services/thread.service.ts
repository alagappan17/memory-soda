import { eq, and, sql } from 'drizzle-orm';
import { generateUserId } from '../lib/generate-user-id.js';
import { db } from '../db/postgres.js';
import { threads } from '../db/schema.js';
import {
  getEffectiveEpisodicSettings,
  openAndProcessEpisode,
} from './episodic-memory.service.js';
import type { ProjectEpisodicSettings } from '@memory-soda/types';

// ── Internal type ─────────────────────────────────────────────────────────────

export interface Thread {
  threadId: string;
  dataset: string;
  projectId: string;
  tags: string[];
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  autoCompactThreshold: number | null;
  /** Per-thread patch over the project's episodic settings, not a full set. */
  episodicSettings: Partial<ProjectEpisodicSettings> | null;
  lastCompactedAt: string | null;
  lastCompactedSequence: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function rowToThread(row: typeof threads.$inferSelect): Thread {
  return {
    threadId: row.id,
    dataset: row.dataset,
    projectId: row.projectId,
    tags: row.tags ?? [],
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastActivityAt: row.lastActivityAt.toISOString(),
    autoCompactThreshold: row.autoCompactThreshold ?? null,
    episodicSettings: row.episodicSettings ?? null,
    lastCompactedAt: row.lastCompactedAt?.toISOString() ?? null,
    lastCompactedSequence: row.lastCompactedSequence,
  };
}

// ── Thread operations ─────────────────────────────────────────────────────────

export interface NewThread {
  projectId: string;
  /** Auto-generated when omitted, so a caller can start without one. */
  dataset?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  autoCompactThreshold?: number;
  /** A patch over the project's episodic settings, not a replacement. */
  episodicOverride?: Partial<ProjectEpisodicSettings>;
}

export async function createThread(input: NewThread): Promise<Thread> {
  const [row] = await db
    .insert(threads)
    .values({
      dataset: input.dataset || generateUserId(),
      projectId: input.projectId,
      tags: input.tags ?? [],
      metadata: input.metadata ?? null,
      autoCompactThreshold: input.autoCompactThreshold ?? null,
      episodicSettings: input.episodicOverride ?? null,
    })
    .returning();
  if (!row) throw new Error('Failed to create thread');
  return rowToThread(row);
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
 * Threads never terminate, "end" marks a natural break point and triggers
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
  const settings = await getEffectiveEpisodicSettings(
    projectId,
    thread.episodicSettings,
  );
  if (!settings.enabled) {
    return { thread, episodeQueued: false };
  }

  // False when the thread has no messages the last episode did not already
  // cover, ending an unchanged thread is a no-op, not a new empty episode.
  const episodeQueued = await openAndProcessEpisode({
    threadId,
    dataset: row.dataset,
    projectId,
  });

  return { thread, episodeQueued };
}

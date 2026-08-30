import {
  eq,
  and,
  asc,
  desc,
  lt,
  lte,
  gte,
  count,
  sql,
  inArray,
  isNotNull,
  ne,
  notExists,
} from 'drizzle-orm';
import { db } from '../db/postgres.js';
import {
  episodes,
  messages,
  projects,
  scheduledEpisodes,
  threads,
} from '../db/schema.js';
import type { EpisodeRow } from '../db/schema.js';
import { extractEpisode, embedText } from '../lib/gemini.js';
import { episodeMessageScope } from '../lib/episode-scope.js';
import { mergeWithDefaults } from '@memory-soda/types';
import type {
  Episode,
  EpisodeContext,
  EpisodeContextItem,
  EpisodeWithRelevance,
  ProjectEpisodicSettings,
} from '@memory-soda/types';
import { extendUsage, log } from '../lib/usage.js';

import { processSemanticMemory } from './semantic-memory.service.js';

// ── Project settings ──────────────────────────────────────────────────────────

export async function getProjectEpisodicSettings(
  projectId: string,
): Promise<ProjectEpisodicSettings> {
  const [row] = await db
    .select({ settings: projects.settings })
    .from(projects)
    .where(eq(projects.id, projectId));

  return mergeWithDefaults(row?.settings).episodic;
}

/**
 * Effective episodic settings for a thread: project defaults with the thread's
 * override layered on top.
 *
 * A thread override is a patch, not a replacement, reading it directly would
 * silently drop every project default the caller did not restate.
 */
export async function getEffectiveEpisodicSettings(
  projectId: string,
  threadOverride?: Partial<ProjectEpisodicSettings> | null,
): Promise<ProjectEpisodicSettings> {
  const base = await getProjectEpisodicSettings(projectId);
  return applyEpisodicOverride(base, threadOverride);
}

/** Layer a partial override over resolved settings, ignoring absent keys. */
export function applyEpisodicOverride(
  base: ProjectEpisodicSettings,
  override?: Partial<ProjectEpisodicSettings> | null,
): ProjectEpisodicSettings {
  if (!override) return base;
  const defined = Object.fromEntries(
    Object.entries(override).filter(([, v]) => v !== undefined),
  );
  return { ...base, ...defined };
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function activeEpisodesFilter(dataset: string, projectId: string) {
  return and(
    eq(episodes.dataset, dataset),
    eq(episodes.projectId, projectId),
    eq(episodes.status, 'completed'),
  );
}

function computeRelevanceScore(
  similarityScore: number,
  endedAt: Date | string | null,
  similarityWeight: number,
  recencyWeight: number,
): number {
  const endedAtMs = endedAt ? new Date(endedAt).getTime() : Date.now();
  const daysSince = (Date.now() - endedAtMs) / 86_400_000;
  const recencyScore = 1 / (1 + daysSince);
  return similarityScore * similarityWeight + recencyScore * recencyWeight;
}

// ── Row mapper ────────────────────────────────────────────────────────────────

function rowToEpisode(row: EpisodeRow): Episode {
  return {
    episodeId: row.id,
    threadId: row.threadId,
    dataset: row.dataset,
    projectId: row.projectId,
    status: row.status,
    summary: row.summary,
    keyLearnings: row.keyLearnings,
    messageCount: row.messageCount,
    tokenCount: row.tokenCount,
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    processingStartedAt: row.processingStartedAt?.toISOString() ?? null,
    processingCompletedAt: row.processingCompletedAt?.toISOString() ?? null,
    error: row.error,
    retryCount: row.retryCount,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const toDate = (value: string | null | undefined): Date | null =>
  value ? new Date(value) : null;

// ── Create ────────────────────────────────────────────────────────────────────

/**
 * Open a pending episode over the messages added since the thread's last
 * episode.
 *
 * The window is the unit of work everywhere downstream: summarisation and
 * semantic extraction both read exactly these messages, so successive episodes
 * on one thread never reprocess each other's turns. Continuity across windows
 * comes from folding the previous episode's summary into the new one
 * ({@link processEpisode}), not from re-reading the whole transcript.
 *
 * Returns null when no new messages have arrived, the auto-episode timer
 * re-arms on every message, so firing on an unchanged thread is routine and
 * must not archive the good episode to replace it with an empty one.
 */
export async function createPendingEpisode(payload: {
  threadId: string;
  dataset: string;
  projectId: string;
}): Promise<EpisodeRow | null> {
  return db.transaction(async (tx) => {
    const [prev] = await tx
      .select({ maxEnd: sql<number | null>`max(${episodes.endSequence})` })
      .from(episodes)
      .where(eq(episodes.threadId, payload.threadId));
    const [tail] = await tx
      .select({ maxSeq: sql<number | null>`max(${messages.sequenceNumber})` })
      .from(messages)
      .where(eq(messages.threadId, payload.threadId));

    const startSequence = (prev?.maxEnd ?? 0) + 1;
    const endSequence = tail?.maxSeq ?? 0;
    if (endSequence < startSequence) return null;

    // Window stats, derived rather than passed in: callers cannot know the
    // range, and a count of the whole thread would misreport every episode
    // after the first.
    // `sql<T>` is an unchecked assertion, so these say what the driver
    // actually returns: node-postgres parses declared columns, but an
    // aggregate expression comes back as a string.
    const [stats] = await tx
      .select({
        messageCount: sql<number>`count(*)::int`,
        tokenCount: sql<
          number | null
        >`sum((${messages.tokens}->>'total')::int)::int`,
        startedAt: sql<string | null>`min(${messages.createdAt})`,
        endedAt: sql<string | null>`max(${messages.createdAt})`,
      })
      .from(messages)
      .where(
        and(
          eq(messages.threadId, payload.threadId),
          gte(messages.sequenceNumber, startSequence),
          lte(messages.sequenceNumber, endSequence),
        ),
      );

    // Only one episode per thread is retrievable, the newest. Older ones are
    // archived but keep their facts and their window stamp.
    await tx
      .update(episodes)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(
        and(
          eq(episodes.threadId, payload.threadId),
          ne(episodes.status, 'archived'),
        ),
      );

    const [row] = await tx
      .insert(episodes)
      .values({
        threadId: payload.threadId,
        dataset: payload.dataset,
        projectId: payload.projectId,
        messageCount: stats?.messageCount ?? 0,
        tokenCount: stats?.tokenCount ?? null,
        startedAt: toDate(stats?.startedAt),
        endedAt: toDate(stats?.endedAt),
        startSequence,
        endSequence,
        status: 'pending',
      })
      .returning();
    return row ?? null;
  });
}

// ── Process ───────────────────────────────────────────────────────────────────

export async function processEpisode(episodeId: string): Promise<void> {
  const now = new Date();
  const t0 = Date.now();
  // Atomic claim: only one worker can move pending/failed → processing.
  const [episode] = await db
    .update(episodes)
    .set({
      status: 'processing',
      processingStartedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(episodes.id, episodeId),
        inArray(episodes.status, ['pending', 'failed']),
      ),
    )
    .returning();

  if (!episode) return;
  extendUsage({
    projectId: episode.projectId,
    dataset: episode.dataset,
    threadId: episode.threadId ?? undefined,
    episodeId: episode.id,
  });
  const span = (
    ok: boolean,
    error: string | null,
    meta: Record<string, unknown>,
  ) =>
    log({
      stage: 'episode',
      kind: 'span',
      latencyMs: Date.now() - t0,
      ok,
      error,
      meta: {
        messageCount: msgRows.length,
        retryCount: episode.retryCount,
        ...meta,
      },
    });

  // Only this episode's window, the same messages semantic extraction will
  // read. Continuity with earlier windows comes from `previousSummary` below,
  // which keeps the cost of an episode proportional to the new turns rather
  // than to the length of the thread.
  const msgRows = episode.threadId
    ? await db
        .select({ role: messages.role, content: messages.content })
        .from(messages)
        .where(
          and(
            eq(messages.threadId, episode.threadId),
            episodeMessageScope(episode),
          ),
        )
        .orderBy(asc(messages.sequenceNumber))
    : [];

  if (msgRows.length === 0) {
    await db
      .update(episodes)
      .set({
        status: 'completed',
        // Nothing to extract, keep semantic state from sticking at 'pending'.
        semanticStatus: 'skipped',
        summary: 'No messages in this thread.',
        keyLearnings: [],
        processingCompletedAt: now,
        updatedAt: now,
      })
      .where(eq(episodes.id, episodeId));
    return;
  }

  const settings = await getProjectEpisodicSettings(episode.projectId);

  // The thread's story so far: the episode this one supersedes. Folding it in
  // keeps the newest episode a summary of the whole thread without re-reading
  // the whole thread.
  const previousSummary = episode.threadId
    ? ((
        await db
          .select({ summary: episodes.summary })
          .from(episodes)
          .where(
            and(
              eq(episodes.threadId, episode.threadId),
              ne(episodes.id, episode.id),
              isNotNull(episodes.summary),
            ),
          )
          .orderBy(desc(episodes.endSequence))
          .limit(1)
      )[0]?.summary ?? null)
    : null;

  // LLM extraction
  let summary: string;
  let keyLearnings: string[];
  try {
    const result = await extractEpisode(
      msgRows,
      settings.maxMessages,
      previousSummary,
    );
    summary = result.summary;
    keyLearnings = result.keyLearnings;
  } catch (err) {
    await db
      .update(episodes)
      .set({
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        updatedAt: now,
      })
      .where(eq(episodes.id, episodeId));
    span(false, err instanceof Error ? err.message : String(err), {});
    return;
  }

  // Embedding
  let embedding: number[] | null = null;
  let embeddingError: string | null = null;
  try {
    embedding = await embedText(summary, 'embed_summary');
  } catch (err) {
    embeddingError = err instanceof Error ? err.message : String(err);
  }

  if (embeddingError) {
    // Save extraction results but mark failed so retry can re-embed
    await db
      .update(episodes)
      .set({
        status: 'failed',
        summary,
        keyLearnings,
        error: `Embedding failed: ${embeddingError}`,
        updatedAt: now,
      })
      .where(eq(episodes.id, episodeId));
    span(false, `Embedding failed: ${embeddingError}`, {});
    return;
  }

  await db
    .update(episodes)
    .set({
      status: 'completed',
      summary,
      keyLearnings,
      embedding,
      // A fresh timestamp: `now` was taken before the model calls.
      processingCompletedAt: new Date(),
      error: null,
      updatedAt: now,
    })
    .where(eq(episodes.id, episodeId));
  span(true, null, { keyLearnings: keyLearnings.length });

  // Fire-and-forget semantic extraction on the now-completed episode.
  processSemanticMemory(episodeId).catch((err) => {
    console.error('[episodic] semantic trigger failed:', err);
  });
}

// ── Retry job ─────────────────────────────────────────────────────────────────

/**
 * Spend one retry from the project's budget and move the episode back to
 * pending.
 *
 * Every retry, automatic or operator-triggered, goes through here, so the
 * count is incremented exactly once per attempt and the budget is enforced on
 * both paths. The compare-and-set on `retryCount` is what makes it exactly
 * once when several workers see the same failed row.
 */
async function claimRetry(
  episodeId: string,
  retryCount: number,
  maxRetries: number,
): Promise<boolean> {
  if (retryCount >= maxRetries) return false;
  const [claimed] = await db
    .update(episodes)
    .set({
      status: 'pending',
      error: null,
      retryCount: retryCount + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(episodes.id, episodeId),
        eq(episodes.status, 'failed'),
        eq(episodes.retryCount, retryCount),
      ),
    )
    .returning({ id: episodes.id });
  return claimed !== undefined;
}

export type RetryOutcome =
  | 'queued'
  | 'not_found'
  | 'not_failed'
  | 'retries_exhausted';

/** Operator-triggered retry of one episode. */
export async function retryEpisode(
  episodeId: string,
  projectId: string,
): Promise<RetryOutcome> {
  const [row] = await db
    .select({
      id: episodes.id,
      status: episodes.status,
      retryCount: episodes.retryCount,
    })
    .from(episodes)
    .where(and(eq(episodes.id, episodeId), eq(episodes.projectId, projectId)));

  if (!row) return 'not_found';
  if (row.status !== 'failed') return 'not_failed';

  const { maxRetries } = await getProjectEpisodicSettings(projectId);
  if (!(await claimRetry(row.id, row.retryCount, maxRetries)))
    return 'retries_exhausted';

  void processEpisode(row.id).catch((err) =>
    console.error('[episodic] retry processEpisode failed:', err),
  );
  return 'queued';
}

/** Background sweep of every failed episode still inside its retry budget. */
export async function retryFailedEpisodes(): Promise<void> {
  const rows = await db
    .select({
      id: episodes.id,
      projectId: episodes.projectId,
      retryCount: episodes.retryCount,
    })
    .from(episodes)
    .where(eq(episodes.status, 'failed'))
    .limit(20);
  if (rows.length === 0) return;

  const settingsMap = await episodicSettingsFor(rows.map((r) => r.projectId));

  for (const row of rows) {
    const maxRetries = settingsMap.get(row.projectId)?.maxRetries;
    if (maxRetries === undefined) continue;
    if (!(await claimRetry(row.id, row.retryCount, maxRetries))) continue;

    void processEpisode(row.id).catch((err) =>
      console.error('[episodic] retry processEpisode failed:', err),
    );
  }
}

// ── Context retrieval (for prepare()) ─────────────────────────────────────────

export async function getEpisodicContext(
  dataset: string,
  projectId: string,
  query: string | undefined,
  contextEpisodes: number,
  similarityWeight: number,
  recencyWeight: number,
  precomputedEmbedding?: number[] | null,
): Promise<EpisodeContext> {
  // Reuse a caller-provided query embedding (prepareThread embeds the query once
  // per turn) to avoid a second embedding call. `null` means the caller already
  // tried and failed, so fall back to recency rather than re-embedding.
  const queryEmbedding =
    precomputedEmbedding !== undefined
      ? precomputedEmbedding
      : query
        ? await embedText(query)
        : null;

  if (!queryEmbedding) {
    const [totalRows, rows] = await Promise.all([
      db
        .select({ count: count() })
        .from(episodes)
        .where(activeEpisodesFilter(dataset, projectId)),
      db
        .select()
        .from(episodes)
        .where(activeEpisodesFilter(dataset, projectId))
        .orderBy(desc(episodes.endedAt))
        .limit(contextEpisodes),
    ]);
    const episodeCount = totalRows[0]?.count ?? 0;
    if (episodeCount === 0) return { episodes: null, episodeCount: 0 };
    return {
      episodes: rows.map((r) => rowToContextItem(r, 1.0)),
      episodeCount,
    };
  }

  const totalRows = await db
    .select({ count: count() })
    .from(episodes)
    .where(activeEpisodesFilter(dataset, projectId));
  const episodeCount = totalRows[0]?.count ?? 0;

  if (episodeCount === 0) return { episodes: null, episodeCount: 0 };

  // Similarity search (uses the embedding resolved above).
  const vectorLiteral = `[${queryEmbedding.join(',')}]`;

  const rows = await db
    .select({
      id: episodes.id,
      summary: episodes.summary,
      keyLearnings: episodes.keyLearnings,
      startedAt: episodes.startedAt,
      endedAt: episodes.endedAt,
      similarityScore: sql<number>`1 - (${episodes.embedding} <=> ${vectorLiteral}::vector)`,
    })
    .from(episodes)
    .where(
      and(
        activeEpisodesFilter(dataset, projectId),
        isNotNull(episodes.embedding),
      ),
    )
    .orderBy(sql`${episodes.embedding} <=> ${vectorLiteral}::vector`)
    .limit(10);

  const scored = rows
    .map((row) => ({
      ...row,
      relevanceScore: computeRelevanceScore(
        row.similarityScore,
        row.endedAt,
        similarityWeight,
        recencyWeight,
      ),
    }))
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, contextEpisodes);

  return {
    episodes: scored.map((r) => ({
      episodeId: r.id,
      summary: r.summary ?? '',
      keyLearnings: r.keyLearnings ?? [],
      startedAt: r.startedAt?.toISOString() ?? '',
      endedAt: r.endedAt?.toISOString() ?? '',
      relevanceScore: r.relevanceScore,
    })),
    episodeCount,
  };
}

function rowToContextItem(
  row: EpisodeRow,
  relevanceScore: number,
): EpisodeContextItem {
  return {
    episodeId: row.id,
    summary: row.summary ?? '',
    keyLearnings: row.keyLearnings ?? [],
    startedAt: row.startedAt?.toISOString() ?? '',
    endedAt: row.endedAt?.toISOString() ?? '',
    relevanceScore,
  };
}

// ── CRUD helpers (for REST API) ───────────────────────────────────────────────

export interface EpisodeListOptions {
  limit: number;
  before?: string;
  /** 'all' skips the status filter entirely. */
  status: EpisodeRow['status'] | 'all';
}

export async function listUserEpisodes(
  dataset: string,
  projectId: string,
  opts: EpisodeListOptions,
): Promise<{ episodes: Episode[]; total: number; hasMore: boolean }> {
  const whereBase = and(
    eq(episodes.dataset, dataset),
    eq(episodes.projectId, projectId),
    opts.status === 'all' ? undefined : eq(episodes.status, opts.status),
  );

  const whereWithCursor = opts.before
    ? and(whereBase, lt(episodes.endedAt, new Date(opts.before)))
    : whereBase;

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(episodes)
      .where(whereWithCursor)
      .orderBy(desc(episodes.endedAt))
      .limit(opts.limit + 1),
    db.select({ count: count() }).from(episodes).where(whereBase),
  ]);

  const hasMore = rows.length > opts.limit;
  return {
    episodes: rows.slice(0, opts.limit).map(rowToEpisode),
    total: totalRows[0]?.count ?? 0,
    hasMore,
  };
}

export async function getEpisode(
  episodeId: string,
  projectId: string,
): Promise<Episode | null> {
  const [row] = await db
    .select()
    .from(episodes)
    .where(and(eq(episodes.id, episodeId), eq(episodes.projectId, projectId)));
  return row ? rowToEpisode(row) : null;
}

export async function softDeleteEpisode(
  episodeId: string,
  projectId: string,
): Promise<Episode | null> {
  const [row] = await db
    .update(episodes)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(and(eq(episodes.id, episodeId), eq(episodes.projectId, projectId)))
    .returning();
  return row ? rowToEpisode(row) : null;
}

export async function getThreadEpisodes(
  threadId: string,
  projectId: string,
): Promise<Episode[]> {
  const rows = await db
    .select()
    .from(episodes)
    .where(
      and(eq(episodes.threadId, threadId), eq(episodes.projectId, projectId)),
    )
    .orderBy(desc(episodes.createdAt));
  return rows.map(rowToEpisode);
}

export async function searchEpisodes(
  dataset: string,
  projectId: string,
  query: string,
  limit: number,
  similarityWeight = 0.7,
  recencyWeight = 0.3,
): Promise<EpisodeWithRelevance[]> {
  const queryEmbedding = await embedText(query);
  const vectorLiteral = `[${queryEmbedding.join(',')}]`;

  const rows = await db
    .select({
      episode: episodes,
      similarityScore: sql<number>`1 - (${episodes.embedding} <=> ${vectorLiteral}::vector)`,
    })
    .from(episodes)
    .where(
      and(
        activeEpisodesFilter(dataset, projectId),
        isNotNull(episodes.embedding),
      ),
    )
    .orderBy(sql`${episodes.embedding} <=> ${vectorLiteral}::vector`)
    .limit(limit * 3);

  return rows
    .map(({ episode: row, similarityScore }) => ({
      ...rowToEpisode(row),
      relevanceScore: computeRelevanceScore(
        similarityScore,
        row.endedAt,
        similarityWeight,
        recencyWeight,
      ),
    }))
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit);
}

export async function processScheduledEpisodes(): Promise<void> {
  // Claim-by-delete: the row is gone before any work starts, so two instances
  // racing for the same due thread cannot both act on it.
  const dueRows = await db
    .delete(scheduledEpisodes)
    .where(
      inArray(
        scheduledEpisodes.threadId,
        db
          .select({ threadId: scheduledEpisodes.threadId })
          .from(scheduledEpisodes)
          .where(lt(scheduledEpisodes.fireAt, new Date()))
          .limit(20),
      ),
    )
    .returning({
      threadId: scheduledEpisodes.threadId,
      projectId: scheduledEpisodes.projectId,
    });
  if (dueRows.length === 0) return;

  const settingsMap = await episodicSettingsFor(
    dueRows.map((r) => r.projectId),
  );

  const threadRows = await db
    .select({ id: threads.id, dataset: threads.dataset })
    .from(threads)
    .where(inArray(threads.id, [...new Set(dueRows.map((r) => r.threadId))]));
  const datasetByThread = new Map(threadRows.map((r) => [r.id, r.dataset]));

  for (const row of dueRows) {
    const settings = settingsMap.get(row.projectId);
    if (!settings?.enabled || settings.autoEpisodeIntervalMs === null) continue;

    const dataset = datasetByThread.get(row.threadId);
    if (dataset === undefined) continue;

    void openAndProcessEpisode({
      threadId: row.threadId,
      dataset,
      projectId: row.projectId,
    }).catch((err) =>
      console.error('[episodic] scheduled episode failed:', err),
    );
  }
}

/** A thread quiet this long with uncaptured messages is treated as abandoned. */
export const ABANDONED_AFTER_MS = 24 * 60 * 60_000;

/**
 * Sleep-time backstop: threads with messages no episode covers, quiet for a
 * day, and with no idle timer waiting on them.
 *
 * The idle timer is the normal path; this exists for the gaps it cannot close:
 * a claimed timer row whose worker died before the pending episode was written,
 * or rows lost to a crash. Cheap because `threads_activity_idx` prunes to the
 * cold tail before the per-thread subqueries run.
 */
export async function sweepAbandonedThreads(): Promise<void> {
  const rows = await findAbandonedThreads();
  if (rows.length === 0) return;

  const settingsMap = await episodicSettingsFor(rows.map((r) => r.projectId));
  for (const row of rows) {
    // Same contract as the timer: a null interval means explicit end() only.
    const settings = settingsMap.get(row.projectId);
    if (!settings?.enabled || settings.autoEpisodeIntervalMs === null) continue;
    await openAndProcessEpisode({
      threadId: row.id,
      dataset: row.dataset,
      projectId: row.projectId,
    });
  }
}

/** The query half of {@link sweepAbandonedThreads}, testable without an LLM. */
export async function findAbandonedThreads(): Promise<
  { id: string; dataset: string; projectId: string }[]
> {
  const quietSince = new Date(Date.now() - ABANDONED_AFTER_MS);
  return db
    .select({
      id: threads.id,
      dataset: threads.dataset,
      projectId: threads.projectId,
    })
    .from(threads)
    .where(
      and(
        lt(threads.lastActivityAt, quietSince),
        notExists(
          db
            .select({ one: sql`1` })
            .from(scheduledEpisodes)
            .where(eq(scheduledEpisodes.threadId, threads.id)),
        ),
        sql`(select max(${messages.sequenceNumber}) from ${messages} where ${messages.threadId} = ${threads.id})
          > coalesce((select max(${episodes.endSequence}) from ${episodes} where ${episodes.threadId} = ${threads.id}), 0)`,
      ),
    )
    .limit(20);
}

/**
 * Open an episode over the thread's new messages and start processing it.
 * Returns false when there was nothing new to capture.
 *
 * The pending row is committed before the LLM work starts so the trigger
 * survives a crash: the sweep picks the episode up rather than losing it.
 */
export async function openAndProcessEpisode(payload: {
  threadId: string;
  dataset: string;
  projectId: string;
}): Promise<boolean> {
  const episode = await createPendingEpisode(payload);
  if (!episode) return false;
  void processEpisode(episode.id).catch((err) =>
    console.error('[episodic] processEpisode failed:', err),
  );
  return true;
}

/** Effective episodic settings for a set of projects, in one query. */
async function episodicSettingsFor(
  projectIds: string[],
): Promise<Map<string, ProjectEpisodicSettings>> {
  const unique = [...new Set(projectIds)];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({ id: projects.id, settings: projects.settings })
    .from(projects)
    .where(inArray(projects.id, unique));
  return new Map(
    rows.map((r) => [r.id, mergeWithDefaults(r.settings).episodic]),
  );
}

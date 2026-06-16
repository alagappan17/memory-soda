import { eq, and, desc, lt, count, sql, isNull, inArray, isNotNull, ne } from 'drizzle-orm';
import { db } from '../db/postgres.js';
import { episodes, messages, projects, threads } from '../db/schema.js';
import type { EpisodeRow } from '../db/schema.js';
import { extractEpisode, embedText } from '../lib/gemini.js';
import type {
  Episode,
  EpisodeContext,
  EpisodeContextItem,
  EpisodeWithRelevance,
  ProjectEpisodicSettings,
  ProjectSettings,
  ProjectSettingsPatch,
} from '@memory-soda/types';
import { mergeWithDefaults } from '../lib/project-settings.js';

// ── Project settings ──────────────────────────────────────────────────────────

export async function getProjectEpisodicSettings(
  projectId: string,
): Promise<ProjectEpisodicSettings> {
  const [row] = await db
    .select({ settings: projects.settings })
    .from(projects)
    .where(eq(projects.id, projectId));

  const raw = row?.settings as ProjectSettings | null | undefined;
  return mergeWithDefaults(raw).episodic;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function activeEpisodesFilter(userId: string, projectId: string) {
  return and(
    eq(episodes.userId, userId),
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
    userId: row.userId,
    projectId: row.projectId,
    status: row.status as Episode['status'],
    summary: row.summary,
    keyLearnings: row.keyLearnings as string[] | null,
    messageCount: row.messageCount,
    tokenCount: row.tokenCount,
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    processingStartedAt: row.processingStartedAt?.toISOString() ?? null,
    processingCompletedAt: row.processingCompletedAt?.toISOString() ?? null,
    error: row.error,
    retryCount: row.retryCount,
    metadata: row.metadata as Record<string, unknown> | null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ── Create ────────────────────────────────────────────────────────────────────

export async function createPendingEpisode(payload: {
  threadId: string;
  userId: string;
  projectId: string;
  messageCount: number;
  tokenCount: number | null;
  startedAt: Date | null;
  endedAt: Date | null;
}): Promise<EpisodeRow> {
  return db.transaction(async (tx) => {
    // Archive any existing active episodes for this thread
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
        userId: payload.userId,
        projectId: payload.projectId,
        messageCount: payload.messageCount,
        tokenCount: payload.tokenCount,
        startedAt: payload.startedAt,
        endedAt: payload.endedAt,
        status: 'pending',
      })
      .returning();
    return row;
  });
}

// ── Process ───────────────────────────────────────────────────────────────────

export async function processEpisode(episodeId: string): Promise<void> {
  const now = new Date();
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

  // Fetch messages for the thread
  const msgRows = episode.threadId
    ? await db
        .select({ role: messages.role, content: messages.content })
        .from(messages)
        .where(
          and(
            eq(messages.threadId, episode.threadId),
            isNull(messages.compactedAt),
          ),
        )
        .orderBy(sql`${messages.sequenceNumber} ASC`)
    : [];

  if (msgRows.length === 0) {
    await db
      .update(episodes)
      .set({
        status: 'completed',
        summary: 'No messages in this thread.',
        keyLearnings: [],
        processingCompletedAt: now,
        updatedAt: now,
      })
      .where(eq(episodes.id, episodeId));
    return;
  }

  const settings = await getProjectEpisodicSettings(episode.projectId);

  // LLM extraction
  let summary: string;
  let keyLearnings: string[];
  try {
    const result = await extractEpisode(msgRows, settings.maxMessages);
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
    return;
  }

  // Embedding
  let embedding: number[] | null = null;
  let embeddingError: string | null = null;
  try {
    embedding = await embedText(summary);
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
    return;
  }

  await db
    .update(episodes)
    .set({
      status: 'completed',
      summary,
      keyLearnings,
      embedding,
      processingCompletedAt: now,
      error: null,
      updatedAt: now,
    })
    .where(eq(episodes.id, episodeId));
}

// ── Retry job ─────────────────────────────────────────────────────────────────

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

  const uniqueProjectIds = [...new Set(rows.map((r) => r.projectId))];
  const projectRows =
    uniqueProjectIds.length > 0
      ? await db
          .select({ id: projects.id, settings: projects.settings })
          .from(projects)
          .where(inArray(projects.id, uniqueProjectIds))
      : [];
  const settingsMap = new Map(
    projectRows.map((r) => [
      r.id,
      mergeWithDefaults(r.settings as ProjectSettingsPatch | null).episodic,
    ]),
  );

  for (const row of rows) {
    const settings = settingsMap.get(row.projectId) ?? mergeWithDefaults(null).episodic;
    if (row.retryCount >= settings.maxRetries) continue;

    // Atomic: only bump retryCount if no other instance already did.
    const [claimed] = await db
      .update(episodes)
      .set({
        error: null,
        retryCount: row.retryCount + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(episodes.id, row.id),
          eq(episodes.status, 'failed'),
          eq(episodes.retryCount, row.retryCount),
        ),
      )
      .returning({ id: episodes.id });
    if (!claimed) continue;

    processEpisode(row.id).catch((err) => {
      console.error('[episodic] retry processEpisode failed:', err);
    });
  }
}

// ── Context retrieval (for prepare()) ─────────────────────────────────────────

export async function getEpisodicContext(
  userId: string,
  projectId: string,
  query: string | undefined,
  contextEpisodes: number,
  similarityWeight: number,
  recencyWeight: number,
): Promise<EpisodeContext> {
  if (!query) {
    const [totalRows, rows] = await Promise.all([
      db.select({ count: count() }).from(episodes).where(activeEpisodesFilter(userId, projectId)),
      db
        .select()
        .from(episodes)
        .where(activeEpisodesFilter(userId, projectId))
        .orderBy(desc(episodes.endedAt))
        .limit(contextEpisodes),
    ]);
    const episodeCount = totalRows[0]?.count ?? 0;
    if (episodeCount === 0) return { episodes: null, episodeCount: 0 };
    return { episodes: rows.map((r) => rowToContextItem(r, 1.0)), episodeCount };
  }

  const totalRows = await db
    .select({ count: count() })
    .from(episodes)
    .where(activeEpisodesFilter(userId, projectId));
  const episodeCount = totalRows[0]?.count ?? 0;

  if (episodeCount === 0) return { episodes: null, episodeCount: 0 };

  // Similarity search
  const queryEmbedding = await embedText(query);
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
      and(activeEpisodesFilter(userId, projectId), isNotNull(episodes.embedding)),
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
      keyLearnings: (r.keyLearnings as string[] | null) ?? [],
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
    keyLearnings: (row.keyLearnings as string[] | null) ?? [],
    startedAt: row.startedAt?.toISOString() ?? '',
    endedAt: row.endedAt?.toISOString() ?? '',
    relevanceScore,
  };
}

// ── CRUD helpers (for REST API) ───────────────────────────────────────────────

export async function listUserEpisodes(
  userId: string,
  projectId: string,
  opts: { limit: number; before?: string; status: string },
): Promise<{ episodes: Episode[]; total: number; hasMore: boolean }> {
  const whereBase = and(
    eq(episodes.userId, userId),
    eq(episodes.projectId, projectId),
    eq(episodes.status, opts.status as EpisodeRow['status']),
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

export async function resetEpisodeForRetry(
  episodeId: string,
  projectId: string,
): Promise<Episode | null> {
  const [row] = await db
    .update(episodes)
    .set({
      status: 'pending',
      error: null,
      retryCount: sql`${episodes.retryCount} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(episodes.id, episodeId),
        eq(episodes.projectId, projectId),
        eq(episodes.status, 'failed'),
      ),
    )
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
    .where(and(eq(episodes.threadId, threadId), eq(episodes.projectId, projectId)))
    .orderBy(desc(episodes.createdAt));
  return rows.map(rowToEpisode);
}

export async function searchEpisodes(
  userId: string,
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
      and(activeEpisodesFilter(userId, projectId), isNotNull(episodes.embedding)),
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
  const due = await db.execute(sql`
    DELETE FROM scheduled_episodes
    WHERE thread_id IN (
      SELECT thread_id FROM scheduled_episodes WHERE fire_at < now() LIMIT 20
    )
    RETURNING thread_id, project_id
  `);

  const dueRows = due.rows as { thread_id: string; project_id: string }[];
  if (dueRows.length === 0) return;

  const uniqueProjectIds = [...new Set(dueRows.map((r) => r.project_id))];
  const projectRows = await db
    .select({ id: projects.id, settings: projects.settings })
    .from(projects)
    .where(inArray(projects.id, uniqueProjectIds));
  const settingsMap = new Map(
    projectRows.map((r) => [
      r.id,
      mergeWithDefaults(r.settings as ProjectSettingsPatch | null).episodic,
    ]),
  );

  const uniqueThreadIds = [...new Set(dueRows.map((r) => r.thread_id))];
  const threadRows = await db
    .select({ id: threads.id, userId: threads.userId, messageCount: threads.messageCount, createdAt: threads.createdAt })
    .from(threads)
    .where(inArray(threads.id, uniqueThreadIds));
  const threadMap = new Map(threadRows.map((r) => [r.id, r]));

  for (const row of dueRows) {
    const settings = settingsMap.get(row.project_id) ?? mergeWithDefaults(null).episodic;
    if (!settings.enabled || settings.autoEpisodeIntervalMs === null) continue;

    const threadRow = threadMap.get(row.thread_id);
    if (!threadRow) continue;

    createPendingEpisode({
      threadId: row.thread_id,
      userId: threadRow.userId,
      projectId: row.project_id,
      messageCount: threadRow.messageCount,
      tokenCount: null,
      startedAt: threadRow.createdAt,
      endedAt: new Date(),
    })
      .then((episode) => processEpisode(episode.id))
      .catch((err) => console.error('[episodic] scheduled episode failed:', err));
  }
}

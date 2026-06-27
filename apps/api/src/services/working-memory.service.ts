import { eq, and, lt, desc, asc, sql, max, inArray, isNull } from 'drizzle-orm';
import { summarizeMessages } from '../lib/gemini.js';
import { db } from '../db/postgres.js';
import { threads, messages, scheduledEpisodes } from '../db/schema.js';
import { getProjectEpisodicSettings } from './episodic-memory.service.js';
import { getProjectSettings } from './project-settings.service.js';
import { NotFoundError } from '../lib/errors.js';
import { type Thread, rowToThread } from './thread.service.js';

export type { Thread };

export interface Message {
  messageId: string;
  threadId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  sequenceNumber: number;
  tokenCount: { input?: number; output?: number; total?: number } | null;
  model: string | null;
  latencyMs: number | null;
  metadata: Record<string, unknown> | null;
  compactedAt: string | null;
  createdAt: string;
}

export interface CompactResult {
  threadId: string;
  summaryMessageId: string;
  compactedCount: number;
  fromSequence: number;
  toSequence: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rowToMessage(row: typeof messages.$inferSelect): Message {
  return {
    messageId: row.id,
    threadId: row.threadId,
    role: row.role,
    content: row.content,
    sequenceNumber: row.sequenceNumber,
    tokenCount: row.tokenCount as Message['tokenCount'],
    model: row.model ?? null,
    latencyMs: row.latencyMs ?? null,
    metadata: row.metadata as Record<string, unknown> | null,
    compactedAt: row.compactedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function isSummaryRow(row: { metadata: unknown }): boolean {
  const meta = row.metadata as Record<string, unknown> | null;
  return meta?.['type'] === 'compact_summary';
}

const notSummarySql = sql`(${messages.metadata}->>'type' IS NULL OR ${messages.metadata}->>'type' != 'compact_summary')`;
const isSummarySql = sql`${messages.metadata}->>'type' = 'compact_summary'`;

// ── Message operations ────────────────────────────────────────────────────────

export async function addMessage(
  threadId: string,
  projectId: string,
  role: 'user' | 'assistant' | 'system' | 'tool',
  content: string,
  tokenCount?: { input?: number; output?: number; total?: number },
  model?: string,
  latencyMs?: number,
  metadata?: Record<string, unknown>,
): Promise<{ message: Message; thread: Thread; compacted: boolean }> {
  let result!: { message: Message; thread: Thread };
  let uncompactedCount = 0;

  await db.transaction(async (tx) => {
    const [threadRow] = await tx
      .select()
      .from(threads)
      .where(and(eq(threads.id, threadId), eq(threads.projectId, projectId)))
      .for('update');

    if (!threadRow) {
      throw new NotFoundError('Thread not found', 'THREAD_NOT_FOUND');
    }

    const [seqRow] = await tx
      .select({ maxSeq: max(messages.sequenceNumber) })
      .from(messages)
      .where(eq(messages.threadId, threadId));
    const nextSeq = (seqRow?.maxSeq ?? 0) + 1;

    const [msgRow] = await tx
      .insert(messages)
      .values({
        threadId,
        role,
        content,
        sequenceNumber: nextSeq,
        tokenCount: tokenCount ?? null,
        model: model ?? null,
        latencyMs: latencyMs ?? null,
        metadata: metadata ?? null,
      })
      .returning();

    const [updatedThread] = await tx
      .update(threads)
      .set({
        messageCount: threadRow.messageCount + 1,
        lastActivityAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(threads.id, threadId))
      .returning();

    const [cntRow] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .where(
        and(
          eq(messages.threadId, threadId),
          isNull(messages.compactedAt),
          notSummarySql,
        ),
      );
    uncompactedCount = cntRow?.count ?? 0;

    result = {
      message: rowToMessage(msgRow!),
      thread: rowToThread(updatedThread!),
    };
  });

  let compacted = false;
  const { thread } = result;

  // Working settings are frozen on the thread at creation; null threshold means
  // auto-compaction is disabled. Legacy threads (no workingSettings) fall back to
  // the legacy column, then to the project default.
  let effectiveThreshold: number | null;
  if (thread.workingSettings) {
    effectiveThreshold = thread.workingSettings.autoCompactThreshold;
  } else if (thread.autoCompactThreshold !== null) {
    effectiveThreshold = thread.autoCompactThreshold;
  } else {
    effectiveThreshold = (await getProjectSettings(projectId)).working
      .autoCompactThreshold;
  }

  if (effectiveThreshold !== null && uncompactedCount >= effectiveThreshold) {
    // Keep the message that triggered compaction verbatim so the next LLM
    // turn sees the user's actual words, not a paraphrase in the summary.
    const compactResult = await compactThread(threadId, projectId, {
      keepLast: 1,
    });
    if (compactResult) compacted = true;
  }

  const rawSettings = thread.episodicSettings;
  const resolvedSettings = rawSettings ?? await getProjectEpisodicSettings(projectId);

  if (resolvedSettings.enabled && resolvedSettings.autoEpisodeIntervalMs !== null) {
    const fireAt = new Date(Date.now() + resolvedSettings.autoEpisodeIntervalMs);
    await db
      .insert(scheduledEpisodes)
      .values({ threadId, projectId, fireAt })
      .onConflictDoUpdate({
        target: scheduledEpisodes.threadId,
        set: { fireAt, projectId },
      });
  }

  return { ...result, compacted };
}

export async function listMessages(
  threadId: string,
  projectId: string,
  opts: {
    limit: number;
    before?: number;
    order: 'asc' | 'desc';
  },
): Promise<{
  messages: Message[];
  total: number;
  hasMore: boolean;
  nextCursor: number | null;
} | null> {
  const [threadRow] = await db
    .select({ id: threads.id })
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.projectId, projectId)));
  if (!threadRow) return null;

  const conditions = [eq(messages.threadId, threadId)];
  if (opts.before !== undefined)
    conditions.push(lt(messages.sequenceNumber, opts.before));

  const orderFn = opts.order === 'desc' ? desc : asc;

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(messages)
      .where(and(...conditions))
      .orderBy(orderFn(messages.sequenceNumber))
      .limit(opts.limit + 1),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .where(eq(messages.threadId, threadId)),
  ]);

  const hasMore = rows.length > opts.limit;
  const page = rows.slice(0, opts.limit).map(rowToMessage);
  // `before` filters sequenceNumber < cursor, so the next-older page starts at
  // the smallest sequence in this page regardless of sort order.
  const nextCursor =
    hasMore && page.length > 0
      ? Math.min(...page.map((m) => m.sequenceNumber))
      : null;
  return {
    messages: page,
    total: totalRows[0]?.count ?? 0,
    hasMore,
    nextCursor,
  };
}

// ── Compact ───────────────────────────────────────────────────────────────────

export async function compactThread(
  threadId: string,
  projectId: string,
  opts: { keepLast?: number } = {},
): Promise<CompactResult | null | false> {
  const keepLast = opts.keepLast ?? 0;
  let existingSummaryRow: typeof messages.$inferSelect | undefined;
  let realRows: (typeof messages.$inferSelect)[];

  const canCompact = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(threads)
      .where(and(eq(threads.id, threadId), eq(threads.projectId, projectId)))
      .for('update');

    if (!row) return 'NOT_FOUND';

    const [summary] = await tx
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.threadId, threadId),
          isNull(messages.compactedAt),
          isSummarySql,
        ),
      )
      .orderBy(desc(messages.sequenceNumber))
      .limit(1);
    existingSummaryRow = summary;

    realRows = await tx
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.threadId, threadId),
          isNull(messages.compactedAt),
          notSummarySql,
        ),
      )
      .orderBy(asc(messages.sequenceNumber));

    return realRows.length > keepLast ? 'CAN_COMPACT' : 'NOTHING_TO_COMPACT';
  });

  if (canCompact === 'NOT_FOUND') return null;
  if (canCompact === 'NOTHING_TO_COMPACT') return false;

  const targetRows = realRows!.slice(0, realRows!.length - keepLast);
  const fromSeq = targetRows[0]!.sequenceNumber;
  const toSeq = targetRows[targetRows.length - 1]!.sequenceNumber;
  const targetIds = targetRows.map((r) => r.id);

  const summaryText = await summarizeMessages(
    targetRows.map((r) => ({ role: r.role, content: r.content })),
    existingSummaryRow?.content ?? null,
  );

  if (!summaryText || summaryText.trim().length === 0) {
    console.error(
      'Compaction failed: summarizeMessages returned empty or blank summary',
    );
    return false;
  }

  let summaryMessageId!: string;

  const committed = await db.transaction(async (tx) => {
    await tx
      .select({ id: threads.id })
      .from(threads)
      .where(eq(threads.id, threadId))
      .for('update');

    // Concurrent compact may have claimed these rows while the LLM call ran.
    const [staleRow] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .where(
        and(inArray(messages.id, targetIds), isNull(messages.compactedAt)),
      );
    if ((staleRow?.count ?? 0) !== targetIds.length) return false;

    const [seqRow] = await tx
      .select({ maxSeq: max(messages.sequenceNumber) })
      .from(messages)
      .where(eq(messages.threadId, threadId));
    const nextSeq = (seqRow?.maxSeq ?? 0) + 1;

    const [summaryRow] = await tx
      .insert(messages)
      .values({
        threadId,
        role: 'system',
        content: summaryText,
        sequenceNumber: nextSeq,
        tokenCount: null,
        model: null,
        latencyMs: null,
        metadata: {
          type: 'compact_summary',
          compactedRange: { fromSeq, toSeq, count: targetRows.length },
        },
      })
      .returning({ id: messages.id });

    summaryMessageId = summaryRow!.id;

    await tx
      .update(messages)
      .set({ compactedAt: new Date() })
      .where(inArray(messages.id, targetIds));

    if (existingSummaryRow) {
      await tx
        .update(messages)
        .set({ compactedAt: new Date() })
        .where(eq(messages.id, existingSummaryRow.id));
    }

    await tx
      .update(threads)
      .set({
        lastCompactedAt: new Date(),
        lastCompactedSequence: toSeq,
        updatedAt: new Date(),
      })
      .where(eq(threads.id, threadId));

    return true;
  });

  if (!committed) return false;

  return {
    threadId,
    summaryMessageId,
    compactedCount: targetRows.length,
    fromSequence: fromSeq,
    toSequence: toSeq,
  };
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export async function getThreadStats(
  threadId: string,
  projectId: string,
): Promise<object | null> {
  const [threadRow] = await db
    .select()
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.projectId, projectId)));
  if (!threadRow) return null;

  const allMessages = await db
    .select()
    .from(messages)
    .where(and(eq(messages.threadId, threadId), isNull(messages.compactedAt)))
    .orderBy(asc(messages.sequenceNumber));

  let tokenUsage: {
    totalInput: number;
    totalOutput: number;
    totalTokens: number;
    averagePerMessage: number;
  } | null = null;

  const withTokens = allMessages.filter(
    (m) => m.tokenCount != null && !isSummaryRow(m),
  );
  if (withTokens.length > 0) {
    let totalInput = 0,
      totalOutput = 0,
      totalTokens = 0;
    for (const msg of withTokens) {
      const tc = msg.tokenCount as {
        input?: number;
        output?: number;
        total?: number;
      };
      totalInput += tc.input ?? 0;
      totalOutput += tc.output ?? 0;
      totalTokens += tc.total ?? 0;
    }
    tokenUsage = {
      totalInput,
      totalOutput,
      totalTokens,
      averagePerMessage: Math.round(totalTokens / withTokens.length),
    };
  }

  const realMessages = allMessages.filter((m) => !isSummaryRow(m));
  let sessionDuration: { ms: number; seconds: number } | null = null;
  if (realMessages.length >= 2) {
    const ms =
      realMessages[realMessages.length - 1]!.createdAt.getTime() -
      realMessages[0]!.createdAt.getTime();
    sessionDuration = { ms, seconds: Math.floor(ms / 1000) };
  }

  return {
    threadId,
    messageCount: allMessages.length,
    tokenUsage,
    sessionDuration,
    createdAt: threadRow.createdAt.toISOString(),
    lastActivityAt: threadRow.lastActivityAt.toISOString(),
  };
}

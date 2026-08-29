import { eq, and, lt, desc, asc, sql, max, inArray, isNull } from 'drizzle-orm';
import { summarizeMessages } from '../lib/gemini.js';
import { AppError } from '../lib/errors.js';
import { db } from '../db/postgres.js';
import { threads, messages, scheduledEpisodes } from '../db/schema.js';
import { getEffectiveEpisodicSettings } from './episodic-memory.service.js';
import type {
  MessageRole,
  WMMessageMetadata,
  WMPrepareResponse,
  WMTokenCount,
} from '@memory-soda/types';
import { type Thread, rowToThread } from './thread.service.js';

export type { Thread };

export interface Message {
  messageId: string;
  threadId: string;
  role: MessageRole;
  content: string;
  sequenceNumber: number;
  tokens: WMTokenCount | null;
  model: string | null;
  latencyMs: number | null;
  metadata: WMMessageMetadata | null;
  compactedAt: string | null;
  createdAt: string;
}

// The prepare result shape is the shared response contract.
export type PrepareResult = WMPrepareResponse;

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
    tokens: row.tokens,
    model: row.model ?? null,
    latencyMs: row.latencyMs ?? null,
    metadata: row.metadata,
    compactedAt: row.compactedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function isSummaryRow(row: { metadata: WMMessageMetadata | null }): boolean {
  return row.metadata?.type === 'compact_summary';
}

const notSummarySql = sql`(${messages.metadata}->>'type' IS NULL OR ${messages.metadata}->>'type' != 'compact_summary')`;
const isSummarySql = sql`${messages.metadata}->>'type' = 'compact_summary'`;

// ── Message operations ────────────────────────────────────────────────────────

export interface NewMessage {
  role: MessageRole;
  content: string;
  tokens?: WMTokenCount;
  model?: string;
  latencyMs?: number;
  metadata?: WMMessageMetadata;
}

export async function addMessage(
  threadId: string,
  projectId: string,
  input: NewMessage,
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
      throw AppError.notFound('Thread');
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
        role: input.role,
        content: input.content,
        sequenceNumber: nextSeq,
        tokens: input.tokens ?? null,
        model: input.model ?? null,
        latencyMs: input.latencyMs ?? null,
        metadata: input.metadata ?? null,
      })
      .returning();

    const [updatedThread] = await tx
      .update(threads)
      .set({
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
  if (
    thread.autoCompactThreshold !== null &&
    uncompactedCount >= thread.autoCompactThreshold
  ) {
    // Keep the message that triggered compaction verbatim so the next LLM
    // turn sees the user's actual words, not a paraphrase in the summary.
    const compactResult = await compactThread(threadId, projectId, {
      keepLast: 1,
    });
    if (compactResult) compacted = true;
  }

  const episodic = await getEffectiveEpisodicSettings(
    projectId,
    thread.episodicSettings,
  );

  if (episodic.enabled && episodic.autoEpisodeIntervalMs !== null) {
    const fireAt = new Date(Date.now() + episodic.autoEpisodeIntervalMs);
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
): Promise<{ messages: Message[]; total: number; hasMore: boolean } | null> {
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
  return {
    messages: rows.slice(0, opts.limit).map(rowToMessage),
    total: totalRows[0]?.count ?? 0,
    hasMore,
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
        tokens: null,
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

// ── Prepare ───────────────────────────────────────────────────────────────────

/**
 * Pure working memory: the thread state needed to continue a conversation,
 * compact summary + recent messages. No embedding or LLM calls; long-term
 * memory (facts/episodes/synthesis) lives in recall.service.ts.
 */
export async function prepareThread(
  threadId: string,
  projectId: string,
  opts: { messageLimit: number },
): Promise<PrepareResult | null> {
  const { messageLimit } = opts;

  const [threadRow] = await db
    .select({
      id: threads.id,
      dataset: threads.dataset,
      autoCompactThreshold: threads.autoCompactThreshold,
    })
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.projectId, projectId)));
  if (!threadRow) return null;

  // The active compact summary is always included first and never counts
  // against messageLimit, shrinking the limit can't drop compacted context.
  const fetchMessages = async () => {
    const realMsgWhere = and(
      eq(messages.threadId, threadId),
      isNull(messages.compactedAt),
      notSummarySql,
    );
    const [summaryRows, [totalRow], realRows] = await Promise.all([
      db
        .select({ role: messages.role, content: messages.content })
        .from(messages)
        .where(
          and(
            eq(messages.threadId, threadId),
            isNull(messages.compactedAt),
            isSummarySql,
          ),
        )
        .orderBy(asc(messages.sequenceNumber)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(messages)
        .where(realMsgWhere),
      db
        .select({ role: messages.role, content: messages.content })
        .from(messages)
        .where(realMsgWhere)
        .orderBy(desc(messages.sequenceNumber))
        .limit(messageLimit),
    ]);
    const realCount = totalRow?.count ?? 0;
    realRows.reverse();
    return { summaryRows, realRows, realCount };
  };

  const { summaryRows, realRows, realCount } = await fetchMessages();

  const threshold = threadRow.autoCompactThreshold ?? null;
  const warning =
    threshold !== null && messageLimit < threshold
      ? `messageLimit (${messageLimit}) is less than autoCompactThreshold (${threshold}). Messages between the compact summary and the retrieved tail may be missing. Set messageLimit >= autoCompactThreshold to ensure full context.`
      : undefined;

  // Deliberately not logged: the response is the conversation itself, and this
  // runs on every turn. Counts only, and only at debug.
  return {
    threadId,
    dataset: threadRow.dataset,
    messages: [...summaryRows, ...realRows],
    messageCount: realCount,
    truncated: realCount > messageLimit,
    compacted: summaryRows.length > 0,
    warning,
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
    (m) => m.tokens != null && !isSummaryRow(m),
  );
  if (withTokens.length > 0) {
    let totalInput = 0,
      totalOutput = 0,
      totalTokens = 0;
    for (const { tokens } of withTokens) {
      totalInput += tokens?.input ?? 0;
      totalOutput += tokens?.output ?? 0;
      totalTokens += tokens?.total ?? 0;
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

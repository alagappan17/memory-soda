import { eq, and, lt, desc, asc, sql, max } from 'drizzle-orm';
import { generateUserId } from '../lib/generate-user-id.js';
import { db } from '../db/postgres.js';
import { threads, messages } from '../db/schema.js';
import {
  memoryEvents,
  type ThreadEndedPayload,
} from '../events/memory-events.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface Thread {
  threadId:       string;
  userId:         string;
  apiKeyId:       string;
  tags:           string[];
  messageCount:   number;
  metadata:       Record<string, unknown> | null;
  createdAt:      string;
  updatedAt:      string;
  endedAt:        string | null;
  lastActivityAt: string;
}

export interface Message {
  messageId:      string;
  threadId:       string;
  role:           'user' | 'assistant' | 'system' | 'tool';
  content:        string;
  sequenceNumber: number;
  tokenCount:     { input?: number; output?: number; total?: number } | null;
  model:          string | null;
  latencyMs:      number | null;
  metadata:       Record<string, unknown> | null;
  createdAt:      string;
}

export interface PrepareResult {
  threadId:     string;
  messages:     { role: string; content: string }[];
  messageCount: number;
  truncated:    boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function rowToThread(row: typeof threads.$inferSelect): Thread {
  return {
    threadId:      row.id,
    userId:        row.userId,
    apiKeyId:      row.apiKeyId,
    tags:          row.tags ?? [],
    messageCount:  row.messageCount,
    metadata:      row.metadata as Record<string, unknown> | null,
    createdAt:     row.createdAt.toISOString(),
    updatedAt:     row.updatedAt.toISOString(),
    endedAt:       row.endedAt?.toISOString() ?? null,
    lastActivityAt: row.lastActivityAt.toISOString(),
  };
}

function rowToMessage(row: typeof messages.$inferSelect): Message {
  return {
    messageId:      row.id,
    threadId:       row.threadId,
    role:           row.role,
    content:        row.content,
    sequenceNumber: row.sequenceNumber,
    tokenCount:     row.tokenCount as Message['tokenCount'],
    model:          row.model ?? null,
    latencyMs:      row.latencyMs ?? null,
    metadata:       row.metadata as Record<string, unknown> | null,
    createdAt:      row.createdAt.toISOString(),
  };
}

// ── Thread operations ────────────────────────────────────────────────────────

export async function createThread(
  apiKeyId: string,
  userId: string | null | undefined,
  tags?: string[],
  metadata?: Record<string, unknown>,
): Promise<Thread> {
  const [row] = await db
    .insert(threads)
    .values({ userId: userId || generateUserId(), apiKeyId, tags: tags ?? [], metadata: metadata ?? null })
    .returning();
  return rowToThread(row!);
}

export async function getThread(
  threadId: string,
  apiKeyId: string,
): Promise<Thread | null> {
  const [row] = await db
    .select()
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.apiKeyId, apiKeyId)));
  return row ? rowToThread(row) : null;
}

export async function updateThreadMetadata(
  threadId: string,
  apiKeyId: string,
  metadata: Record<string, unknown>,
): Promise<Thread | null> {
  const [row] = await db
    .update(threads)
    .set({
      metadata: sql`COALESCE(${threads.metadata}, '{}'::jsonb) || ${JSON.stringify(metadata)}::jsonb`,
      updatedAt: new Date(),
    })
    .where(and(eq(threads.id, threadId), eq(threads.apiKeyId, apiKeyId)))
    .returning();
  if (!row) return null;
  return rowToThread(row);
}

export async function endThread(
  threadId: string,
  apiKeyId: string,
): Promise<Thread | null> {
  const [row] = await db
    .update(threads)
    .set({ endedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(threads.id, threadId), eq(threads.apiKeyId, apiKeyId)))
    .returning();
  if (!row) return null;
  const payload: ThreadEndedPayload = {
    threadId,
    apiKeyId,
    userId: row.userId,
  };
  setImmediate(() => memoryEvents.emit('thread:ended', payload));
  return rowToThread(row);
}

// ── Message operations ───────────────────────────────────────────────────────

export async function addMessage(
  threadId: string,
  apiKeyId: string,
  role: 'user' | 'assistant' | 'system' | 'tool',
  content: string,
  tokenCount?: { input?: number; output?: number; total?: number },
  model?: string,
  latencyMs?: number,
  metadata?: Record<string, unknown>,
): Promise<{ message: Message; thread: Thread }> {
  let result!: { message: Message; thread: Thread };

  await db.transaction(async (tx) => {
    const [threadRow] = await tx
      .select()
      .from(threads)
      .where(and(eq(threads.id, threadId), eq(threads.apiKeyId, apiKeyId)))
      .for('update');

    if (!threadRow) {
      throw Object.assign(new Error('Thread not found'), { code: 'NOT_FOUND' });
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
        model:      model      ?? null,
        latencyMs:  latencyMs  ?? null,
        metadata:   metadata   ?? null,
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

    result = {
      message: rowToMessage(msgRow!),
      thread: rowToThread(updatedThread!),
    };
  });

  return result;
}

export async function listMessages(
  threadId: string,
  apiKeyId: string,
  opts: {
    limit: number;
    before?: number;
    order: 'asc' | 'desc';
  },
): Promise<{ messages: Message[]; total: number; hasMore: boolean } | null> {
  const [threadRow] = await db
    .select({ id: threads.id })
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.apiKeyId, apiKeyId)));
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

// ── Prepare ──────────────────────────────────────────────────────────────────

export async function prepareThread(
  threadId: string,
  apiKeyId: string,
  messageLimit: number,
): Promise<PrepareResult | null> {
  const [threadRow] = await db
    .select({ id: threads.id, messageCount: threads.messageCount })
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.apiKeyId, apiKeyId)));
  if (!threadRow) return null;

  const [totalRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messages)
    .where(eq(messages.threadId, threadId));
  const totalCount = totalRow?.count ?? 0;

  const rows = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(desc(messages.sequenceNumber))
    .limit(messageLimit);

  rows.reverse();

  return {
    threadId,
    messages: rows,
    messageCount: totalCount,
    truncated: totalCount > messageLimit,
  };
}

// ── Stats ────────────────────────────────────────────────────────────────────

export async function getThreadStats(
  threadId: string,
  apiKeyId: string,
): Promise<object | null> {
  const [threadRow] = await db
    .select()
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.apiKeyId, apiKeyId)));
  if (!threadRow) return null;

  const allMessages = await db
    .select()
    .from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(asc(messages.sequenceNumber));

  // Token usage
  let tokenUsage: {
    totalInput: number;
    totalOutput: number;
    totalTokens: number;
    averagePerMessage: number;
  } | null = null;

  const withTokens = allMessages.filter((m) => m.tokenCount != null);
  if (withTokens.length > 0) {
    let totalInput = 0, totalOutput = 0, totalTokens = 0;
    for (const msg of withTokens) {
      const tc = msg.tokenCount as { input?: number; output?: number; total?: number };
      totalInput  += tc.input  ?? 0;
      totalOutput += tc.output ?? 0;
      totalTokens += tc.total  ?? 0;
    }
    tokenUsage = {
      totalInput,
      totalOutput,
      totalTokens,
      averagePerMessage: Math.round(totalTokens / withTokens.length),
    };
  }

  // Session duration
  let sessionDuration: { ms: number; seconds: number } | null = null;
  if (allMessages.length >= 2) {
    const ms = allMessages[allMessages.length - 1]!.createdAt.getTime()
             - allMessages[0]!.createdAt.getTime();
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

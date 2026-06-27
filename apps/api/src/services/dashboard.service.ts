import { eq, and, desc, asc, sql } from 'drizzle-orm';
import { db } from '../db/postgres.js';
import { threads, messages } from '../db/schema.js';

export interface DashboardThread {
  threadId: string;
  userId: string;
  projectId: string;
  title: string | null;
  tags: string[];
  messageCount: number;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
}

export interface DashboardMessage {
  messageId: string;
  threadId: string;
  role: string;
  content: string;
  sequenceNumber: number;
  tokenCount: unknown;
  model: string | null;
  latencyMs: number | null;
  metadata: unknown;
  createdAt: string;
}

function mapThread(row: typeof threads.$inferSelect): DashboardThread {
  return {
    threadId: row.id,
    userId: row.userId,
    projectId: row.projectId,
    title: row.title ?? null,
    tags: row.tags ?? [],
    messageCount: row.messageCount,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastActivityAt: row.lastActivityAt.toISOString(),
  };
}

function mapMessage(row: typeof messages.$inferSelect): DashboardMessage {
  return {
    messageId: row.id,
    threadId: row.threadId,
    role: row.role,
    content: row.content,
    sequenceNumber: row.sequenceNumber,
    tokenCount: row.tokenCount,
    model: row.model ?? null,
    latencyMs: row.latencyMs ?? null,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listThreads(opts: {
  projectId: string;
  userId?: string;
  limit: number;
  offset: number;
}): Promise<{ threads: DashboardThread[]; total: number }> {
  const conditions = [eq(threads.projectId, opts.projectId)];
  if (opts.userId) conditions.push(eq(threads.userId, opts.userId));

  const where = and(...conditions);

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(threads)
      .where(where)
      .orderBy(desc(threads.lastActivityAt))
      .limit(opts.limit)
      .offset(opts.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(threads)
      .where(where),
  ]);

  return {
    threads: rows.map(mapThread),
    total: totalRows[0]?.count ?? 0,
  };
}

export async function getThreadWithMessages(
  threadId: string,
  projectId: string,
): Promise<{ thread: DashboardThread; messages: DashboardMessage[] } | null> {
  const [threadRow] = await db
    .select()
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.projectId, projectId)));

  if (!threadRow) return null;

  const msgRows = await db
    .select()
    .from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(asc(messages.sequenceNumber));

  return {
    thread: mapThread(threadRow),
    messages: msgRows.map(mapMessage),
  };
}

import { eq, and, desc, asc, sql, inArray, getTableColumns } from 'drizzle-orm';
import { db } from '../db/postgres.js';
import { threads, messages, facts, isLiveFact } from '../db/schema.js';

export interface DashboardThread {
  threadId: string;
  dataset: string;
  projectId: string;
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
  tokens: unknown;
  model: string | null;
  latencyMs: number | null;
  metadata: unknown;
  createdAt: string;
}

// `threads.message_count` was a denormalized counter that could drift; the
// count is derived live instead. Shared by both thread reads below.
//
// The outer `threads.id` MUST stay explicitly qualified: drizzle renders
// interpolated columns unqualified, and a bare `"id"` inside the subquery binds
// to `messages.id` (the nearer scope), making the predicate always false and
// every count 0.
const messageCountSql = sql<number>`(select count(*)::int from ${messages} where ${messages.threadId} = ${threads}."id")`;

const threadColumns = () => ({
  ...getTableColumns(threads),
  messageCount: messageCountSql,
});

function mapThread(
  row: typeof threads.$inferSelect & { messageCount: number },
): DashboardThread {
  return {
    threadId: row.id,
    dataset: row.dataset,
    projectId: row.projectId,
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
    tokens: row.tokens,
    model: row.model ?? null,
    latencyMs: row.latencyMs ?? null,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listThreads(opts: {
  projectId: string;
  dataset?: string;
  limit: number;
  offset: number;
}): Promise<{ threads: DashboardThread[]; total: number }> {
  const conditions = [eq(threads.projectId, opts.projectId)];
  if (opts.dataset) conditions.push(eq(threads.dataset, opts.dataset));

  const where = and(...conditions);

  const [rows, totalRows] = await Promise.all([
    db
      .select(threadColumns())
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

export interface DashboardUser {
  dataset: string;
  threadCount: number;
  factCount: number;
  lastActivityAt: string | null;
}

/**
 * Distinct users (subjects) for a project, derived from threads, with thread and
 * live-fact counts. Powers the user-first admin hub.
 */
export async function listUsers(opts: {
  projectId: string;
  q?: string;
  limit: number;
  offset: number;
}): Promise<{ users: DashboardUser[]; total: number }> {
  const conditions = [eq(threads.projectId, opts.projectId)];
  if (opts.q && opts.q.trim()) {
    conditions.push(sql`${threads.dataset} ILIKE ${`%${opts.q.trim()}%`}`);
  }
  const where = and(...conditions);

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        dataset: threads.dataset,
        threadCount: sql<number>`count(*)::int`,
        lastActivityAt: sql<string>`max(${threads.lastActivityAt})`,
      })
      .from(threads)
      .where(where)
      .groupBy(threads.dataset)
      .orderBy(desc(sql`max(${threads.lastActivityAt})`))
      .limit(opts.limit)
      .offset(opts.offset),
    db
      .select({ count: sql<number>`count(distinct ${threads.dataset})::int` })
      .from(threads)
      .where(where),
  ]);

  // Live-fact counts for the page of users, in one query.
  const datasets = rows.map((r) => r.dataset);
  const factCounts = new Map<string, number>();
  if (datasets.length > 0) {
    const fc = await db
      .select({ dataset: facts.dataset, c: sql<number>`count(*)::int` })
      .from(facts)
      .where(
        and(
          eq(facts.projectId, opts.projectId),
          isLiveFact,
          inArray(facts.dataset, datasets),
        ),
      )
      .groupBy(facts.dataset);
    for (const r of fc) factCounts.set(r.dataset, r.c);
  }

  return {
    users: rows.map((r) => ({
      dataset: r.dataset,
      threadCount: r.threadCount,
      factCount: factCounts.get(r.dataset) ?? 0,
      lastActivityAt: r.lastActivityAt
        ? new Date(r.lastActivityAt).toISOString()
        : null,
    })),
    total: totalRows[0]?.count ?? 0,
  };
}

export async function getThreadWithMessages(
  threadId: string,
  projectId: string,
): Promise<{ thread: DashboardThread; messages: DashboardMessage[] } | null> {
  const [threadRow] = await db
    .select(threadColumns())
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

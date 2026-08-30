import { and, desc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import { db } from '../db/postgres.js';
import {
  apiKeys,
  entities,
  episodes,
  facts,
  messages,
  threads,
  usageLogs,
} from '../db/schema.js';
import { costOf } from '../lib/usage.js';
import type {
  MemoryCounts,
  MemoryGrowthRow,
  UsageBreakdownRow,
  UsageBucket,
  UsageBucketRow,
  UsageByKeyRow,
  UsageKind,
  UsageLogRow,
  UsageLogsResponse,
  UsageSource,
  UsageSummary,
  UsageTotals,
} from '@memory-soda/types';

/**
 * Read side of the usage log. Everything is aggregated straight off the raw
 * rows: cost is priced here from `service` + `model`, never stored.
 */

export interface UsageFilter {
  projectId: string;
  from: Date;
  to: Date;
  dataset?: string;
  source?: UsageSource;
  operation?: string;
  stage?: string;
  kind?: UsageKind;
  service?: string;
  model?: string;
  apiKeyId?: string;
}

function whereOf(f: UsageFilter): SQL {
  const conds = [
    eq(usageLogs.projectId, f.projectId),
    gte(usageLogs.createdAt, f.from),
    lte(usageLogs.createdAt, f.to),
  ];
  if (f.dataset) conds.push(eq(usageLogs.dataset, f.dataset));
  if (f.source) conds.push(eq(usageLogs.source, f.source));
  if (f.operation) conds.push(eq(usageLogs.operation, f.operation));
  if (f.stage) conds.push(eq(usageLogs.stage, f.stage));
  if (f.kind) conds.push(eq(usageLogs.kind, f.kind));
  if (f.service) conds.push(eq(usageLogs.service, f.service));
  if (f.model) conds.push(eq(usageLogs.model, f.model));
  if (f.apiKeyId) conds.push(eq(usageLogs.apiKeyId, f.apiKeyId));
  return and(...conds)!;
}

// Aggregates shared by every grouping. Cost needs the model, so groupings
// that don't include it are priced by summing per-model sub-rows.
const agg = {
  calls: sql<number>`sum(${usageLogs.calls})::int`,
  errors: sql<number>`count(*) filter (where not ${usageLogs.ok})::int`,
  inputTokens: sql<number>`sum(${usageLogs.inputTokens})::int`,
  outputTokens: sql<number>`sum(${usageLogs.outputTokens})::int`,
  inputChars: sql<number>`sum(${usageLogs.inputChars})::int`,
  p50LatencyMs: sql<
    number | null
  >`percentile_cont(0.5) within group (order by ${usageLogs.latencyMs})::int`,
  p95LatencyMs: sql<
    number | null
  >`percentile_cont(0.95) within group (order by ${usageLogs.latencyMs})::int`,
};

interface PricedRow {
  service: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  inputChars: number;
}

/** Sum the cost of per-model rows; `unpriced` when any row had no price. */
function price(rows: PricedRow[]): { costUsd: number; unpriced: boolean } {
  let costUsd = 0;
  let unpriced = false;
  for (const r of rows) {
    // Spans carry no model and cost nothing; only priced kinds count.
    if (!r.service) continue;
    const c = costOf(r);
    if (c === null) unpriced = true;
    else costUsd += c;
  }
  return { costUsd, unpriced };
}

const bucketSql = (bucket: UsageBucket, col: AnyPgColumn) =>
  sql<string>`to_char(date_trunc(${bucket}, ${col}), 'YYYY-MM-DD')`;

export async function getUsageSummary(
  f: UsageFilter,
  bucket: UsageBucket,
): Promise<UsageSummary> {
  const where = whereOf(f);

  const [breakdownRaw, perModel, byDatasetRaw, byKeyRaw, seriesRaw, totalsRaw] =
    await Promise.all([
      db
        .select({
          source: usageLogs.source,
          operation: usageLogs.operation,
          stage: usageLogs.stage,
          kind: usageLogs.kind,
          service: usageLogs.service,
          model: usageLogs.model,
          ...agg,
        })
        .from(usageLogs)
        .where(where)
        .groupBy(
          usageLogs.source,
          usageLogs.operation,
          usageLogs.stage,
          usageLogs.kind,
          usageLogs.service,
          usageLogs.model,
        ),
      db
        .select({
          service: usageLogs.service,
          model: usageLogs.model,
          inputTokens: agg.inputTokens,
          outputTokens: agg.outputTokens,
          inputChars: agg.inputChars,
        })
        .from(usageLogs)
        .where(where)
        .groupBy(usageLogs.service, usageLogs.model),
      db
        .select({
          key: usageLogs.dataset,
          service: usageLogs.service,
          model: usageLogs.model,
          calls: agg.calls,
          inputTokens: agg.inputTokens,
          outputTokens: agg.outputTokens,
          inputChars: agg.inputChars,
        })
        .from(usageLogs)
        .where(where)
        .groupBy(usageLogs.dataset, usageLogs.service, usageLogs.model),
      db
        .select({
          key: usageLogs.apiKeyId,
          label: apiKeys.name,
          service: usageLogs.service,
          model: usageLogs.model,
          calls: agg.calls,
          inputTokens: agg.inputTokens,
          outputTokens: agg.outputTokens,
          inputChars: agg.inputChars,
        })
        .from(usageLogs)
        .leftJoin(apiKeys, eq(apiKeys.id, usageLogs.apiKeyId))
        .where(where)
        .groupBy(
          usageLogs.apiKeyId,
          apiKeys.name,
          usageLogs.service,
          usageLogs.model,
        ),
      db
        .select({
          bucket: bucketSql(bucket, usageLogs.createdAt),
          service: usageLogs.service,
          model: usageLogs.model,
          calls: agg.calls,
          errors: agg.errors,
          inputTokens: agg.inputTokens,
          outputTokens: agg.outputTokens,
          inputChars: agg.inputChars,
        })
        .from(usageLogs)
        .where(where)
        .groupBy(sql`1`, usageLogs.service, usageLogs.model),
      db.select(agg).from(usageLogs).where(where),
    ]);

  const t = totalsRaw[0];
  const totals: UsageTotals = {
    calls: t?.calls ?? 0,
    errors: t?.errors ?? 0,
    inputTokens: t?.inputTokens ?? 0,
    outputTokens: t?.outputTokens ?? 0,
    inputChars: t?.inputChars ?? 0,
    p50LatencyMs: t?.p50LatencyMs ?? null,
    p95LatencyMs: t?.p95LatencyMs ?? null,
    ...price(perModel),
  };

  const breakdown: UsageBreakdownRow[] = breakdownRaw.map((r) => ({
    ...r,
    ...price([r]),
  }));

  // Collapse per-model sub-rows into one row per key, pricing as we go.
  const rollup = (
    rows: (PricedRow & {
      key: string | null;
      label?: string | null;
      calls: number;
    })[],
  ): UsageByKeyRow[] => {
    const out = new Map<string | null, UsageByKeyRow>();
    for (const r of rows) {
      const cur = out.get(r.key) ?? {
        key: r.key,
        label: r.label ?? null,
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      };
      cur.calls += r.calls;
      cur.inputTokens += r.inputTokens;
      cur.outputTokens += r.outputTokens;
      cur.costUsd += price([r]).costUsd;
      out.set(r.key, cur);
    }
    return [...out.values()].sort((a, b) => b.costUsd - a.costUsd).slice(0, 20);
  };

  const series = new Map<string, UsageBucketRow>();
  for (const r of seriesRaw) {
    const cur = series.get(r.bucket) ?? {
      bucket: r.bucket,
      calls: 0,
      errors: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };
    cur.calls += r.calls;
    cur.errors += r.errors;
    cur.inputTokens += r.inputTokens;
    cur.outputTokens += r.outputTokens;
    cur.costUsd += price([r]).costUsd;
    series.set(r.bucket, cur);
  }

  const [memory, memoryGrowth] = await Promise.all([
    getMemoryCounts(f.projectId, f.dataset),
    getMemoryGrowth(f, bucket),
  ]);

  return {
    from: f.from.toISOString(),
    to: f.to.toISOString(),
    bucket,
    totals,
    breakdown,
    byDataset: rollup(byDatasetRaw),
    byApiKey: rollup(byKeyRaw),
    timeseries: [...series.values()].sort((a, b) =>
      a.bucket.localeCompare(b.bucket),
    ),
    memory,
    memoryGrowth,
  };
}

/** Whole-project (or one dataset's) memory footprint right now. */
async function getMemoryCounts(
  projectId: string,
  dataset?: string,
): Promise<MemoryCounts> {
  const tThreads = dataset
    ? and(eq(threads.projectId, projectId), eq(threads.dataset, dataset))
    : eq(threads.projectId, projectId);
  const tEpisodes = dataset
    ? and(eq(episodes.projectId, projectId), eq(episodes.dataset, dataset))
    : eq(episodes.projectId, projectId);
  const tFacts = dataset
    ? and(eq(facts.projectId, projectId), eq(facts.dataset, dataset))
    : eq(facts.projectId, projectId);
  const tEntities = dataset
    ? and(eq(entities.projectId, projectId), eq(entities.dataset, dataset))
    : eq(entities.projectId, projectId);

  const [[th], [msg], ep, [fc], [en]] = await Promise.all([
    db
      .select({
        threads: sql<number>`count(*)::int`,
        datasets: sql<number>`count(distinct ${threads.dataset})::int`,
      })
      .from(threads)
      .where(tThreads),
    db
      .select({
        messages: sql<number>`count(*)::int`,
        // The tenant's own token counts, stored as jsonb {input, output, total}.
        messageTokens: sql<number>`coalesce(sum(coalesce((${messages.tokens}->>'total')::int, (${messages.tokens}->>'input')::int + (${messages.tokens}->>'output')::int, 0)), 0)::int`,
      })
      .from(messages)
      .innerJoin(threads, eq(threads.id, messages.threadId))
      .where(tThreads),
    db
      .select({ status: episodes.status, n: sql<number>`count(*)::int` })
      .from(episodes)
      .where(tEpisodes)
      .groupBy(episodes.status),
    db
      .select({
        live: sql<number>`count(*) filter (where ${facts.invalidAt} is null)::int`,
        invalidated: sql<number>`count(*) filter (where ${facts.invalidAt} is not null)::int`,
      })
      .from(facts)
      .where(tFacts),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(entities)
      .where(tEntities),
  ]);

  return {
    threads: th?.threads ?? 0,
    datasets: th?.datasets ?? 0,
    messages: msg?.messages ?? 0,
    messageTokens: msg?.messageTokens ?? 0,
    episodes: Object.fromEntries(ep.map((r) => [r.status, r.n])),
    factsLive: fc?.live ?? 0,
    factsInvalidated: fc?.invalidated ?? 0,
    entities: en?.n ?? 0,
  };
}

/** New rows per bucket for each memory table, over the same window. */
async function getMemoryGrowth(
  f: UsageFilter,
  bucket: UsageBucket,
): Promise<MemoryGrowthRow[]> {
  const inWindow = (col: AnyPgColumn) => and(gte(col, f.from), lte(col, f.to));
  const ds = (col: AnyPgColumn) => (f.dataset ? eq(col, f.dataset) : undefined);
  const count = (
    table: PgTable,
    createdAt: AnyPgColumn,
    where: SQL | undefined,
  ) =>
    db
      .select({
        bucket: bucketSql(bucket, createdAt),
        n: sql<number>`count(*)::int`,
      })
      .from(table)
      .where(where)
      .groupBy(sql`1`);

  const [th, msg, ep, fc, en] = await Promise.all([
    count(
      threads,
      threads.createdAt,
      and(
        eq(threads.projectId, f.projectId),
        ds(threads.dataset),
        inWindow(threads.createdAt),
      ),
    ),
    db
      .select({
        bucket: bucketSql(bucket, messages.createdAt),
        n: sql<number>`count(*)::int`,
      })
      .from(messages)
      .innerJoin(threads, eq(threads.id, messages.threadId))
      .where(
        and(
          eq(threads.projectId, f.projectId),
          ds(threads.dataset),
          inWindow(messages.createdAt),
        ),
      )
      .groupBy(sql`1`),
    count(
      episodes,
      episodes.createdAt,
      and(
        eq(episodes.projectId, f.projectId),
        ds(episodes.dataset),
        inWindow(episodes.createdAt),
      ),
    ),
    count(
      facts,
      facts.createdAt,
      and(
        eq(facts.projectId, f.projectId),
        ds(facts.dataset),
        inWindow(facts.createdAt),
      ),
    ),
    count(
      entities,
      entities.createdAt,
      and(
        eq(entities.projectId, f.projectId),
        ds(entities.dataset),
        inWindow(entities.createdAt),
      ),
    ),
  ]);

  const rows = new Map<string, MemoryGrowthRow>();
  const put = (
    list: { bucket: string; n: number }[],
    key: keyof Omit<MemoryGrowthRow, 'bucket'>,
  ) => {
    for (const r of list) {
      const cur = rows.get(r.bucket) ?? {
        bucket: r.bucket,
        threads: 0,
        messages: 0,
        episodes: 0,
        facts: 0,
        entities: 0,
      };
      cur[key] = r.n;
      rows.set(r.bucket, cur);
    }
  };
  put(th, 'threads');
  put(msg, 'messages');
  put(ep, 'episodes');
  put(fc, 'facts');
  put(en, 'entities');
  return [...rows.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
}

/** Raw rows, newest first. The cursor is the `createdAt` of the last row. */
export async function listUsageLogs(
  f: UsageFilter,
  opts: { limit: number; cursor?: Date },
): Promise<UsageLogsResponse> {
  const where = opts.cursor
    ? and(whereOf(f), lt(usageLogs.createdAt, opts.cursor))
    : whereOf(f);
  const rows = await db
    .select()
    .from(usageLogs)
    .where(where)
    .orderBy(desc(usageLogs.createdAt), desc(usageLogs.id))
    .limit(opts.limit + 1);

  const page = rows.slice(0, opts.limit);
  const logs: UsageLogRow[] = page.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    costUsd: r.service ? costOf(r) : null,
  }));
  const last = page[page.length - 1];
  return {
    logs,
    nextCursor:
      rows.length > opts.limit && last ? last.createdAt.toISOString() : null,
  };
}

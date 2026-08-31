import { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { useProject } from '../providers/project-provider';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { UsageChart } from '@/components/usage-chart';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type {
  UsageBreakdownRow,
  UsageBucket,
  UsageLogRow,
  UsageLogsResponse,
  UsageSummary,
} from '@memory-soda/types';

/**
 * Usage: what the platform spent (model calls, embeddings, latency) and how
 * memory has grown, over a window, with filters. Everything is read from the
 * usage log; the page only pivots and formats.
 */

const DAY = 24 * 60 * 60 * 1000;
const RANGES = [
  { label: '7 days', days: 7, bucket: 'day' },
  { label: '30 days', days: 30, bucket: 'day' },
  { label: '90 days', days: 90, bucket: 'week' },
  { label: '12 months', days: 365, bucket: 'month' },
] as const;

type Tab = 'overview' | 'breakdown' | 'memory' | 'logs';
const PIVOTS = ['stage', 'operation', 'model', 'source', 'kind'] as const;
type Pivot = (typeof PIVOTS)[number];
const MEMORY_SERIES = [
  {
    key: 'threads',
    info: 'Conversations created in each period, across the selected datasets.',
  },
  { key: 'messages', info: 'Messages added to working memory in each period.' },
  {
    key: 'episodes',
    info: 'Episodes opened in each period: stretches of conversation summarised by the worker.',
  },
  {
    key: 'facts',
    info: 'Facts extracted into semantic memory in each period, live and later-invalidated alike.',
  },
  {
    key: 'entities',
    info: 'New entities (people, places, products…) resolved in each period.',
  },
] as const;
const PIVOT_LABELS: Record<Pivot, string> = {
  stage: 'Stage',
  operation: 'Operation',
  model: 'Service / model',
  source: 'Source',
  kind: 'Kind',
};

const fmtInt = (n: number) => n.toLocaleString();
const fmtTokens = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(2)}M`
    : n >= 1000
      ? `${(n / 1000).toFixed(1)}k`
      : String(n);
const fmtUsd = (n: number) =>
  n < 0.01 && n > 0 ? '<$0.01' : `$${n.toFixed(2)}`;
const fmtMs = (n: number | null) =>
  n === null ? '—' : n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${n}ms`;
const pct = (a: number, b: number) =>
  b === 0 ? '0%' : `${((100 * a) / b).toFixed(1)}%`;

/** One filter dropdown. `''` means "all"; base-ui needs a non-empty value, so it maps to ALL. */
const ALL = '__all__';
function Filter({
  value,
  onChange,
  all,
  options,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  all: string;
  options: { value: string; label: string }[];
  className?: string;
}) {
  const label = options.find((o) => o.value === value)?.label ?? all;
  return (
    <Select<string>
      value={value || ALL}
      onValueChange={(v) => onChange(!v || v === ALL ? '' : v)}
    >
      <SelectTrigger
        className={`h-8 w-auto min-w-36 text-xs ${className ?? ''}`}
      >
        <SelectValue>{label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL} className="text-xs">
          {all}
        </SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="text-xs">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Tile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="px-4 py-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-xl font-semibold tabular-nums mt-1">{value}</div>
        {sub && (
          <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
        )}
      </CardContent>
    </Card>
  );
}

function Th({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: boolean;
}) {
  return (
    <TableHead className={right ? 'text-right' : ''}>{children}</TableHead>
  );
}
function Td({
  children,
  right,
  mono,
}: {
  children: React.ReactNode;
  right?: boolean;
  mono?: boolean;
}) {
  return (
    <TableCell
      className={`${right ? 'text-right tabular-nums' : ''} ${mono ? 'font-mono text-xs' : ''}`}
    >
      {children}
    </TableCell>
  );
}

function pivotRows(rows: UsageBreakdownRow[], by: Pivot) {
  const keyOf = (r: UsageBreakdownRow) =>
    by === 'model'
      ? r.service
        ? `${r.service} / ${r.model}`
        : '— (span)'
      : String(r[by]);
  const out = new Map<
    string,
    UsageBreakdownRow & { name: string; n: number }
  >();
  for (const r of rows) {
    const k = keyOf(r);
    const cur = out.get(k) ?? {
      ...r,
      name: k,
      calls: 0,
      errors: 0,
      inputTokens: 0,
      outputTokens: 0,
      inputChars: 0,
      costUsd: 0,
      unpriced: false,
      p50LatencyMs: 0,
      p95LatencyMs: 0,
      n: 0,
    };
    cur.calls += r.calls;
    cur.errors += r.errors;
    cur.inputTokens += r.inputTokens;
    cur.outputTokens += r.outputTokens;
    cur.costUsd += r.costUsd;
    cur.unpriced ||= r.unpriced;
    // Weighted mean of group percentiles: an approximation, but honest enough
    // for a table; the logs tab has the raw numbers.
    cur.p50LatencyMs =
      ((cur.p50LatencyMs ?? 0) * cur.n + (r.p50LatencyMs ?? 0) * r.calls) /
      (cur.n + r.calls);
    cur.p95LatencyMs = Math.max(cur.p95LatencyMs ?? 0, r.p95LatencyMs ?? 0);
    cur.n += r.calls;
    out.set(k, cur);
  }
  return [...out.values()].sort(
    (a, b) => b.costUsd - a.costUsd || b.calls - a.calls,
  );
}

export default function UsagePage() {
  const { selectedProject } = useProject();
  const [range, setRange] = useState(1);
  const [dataset, setDataset] = useState('');
  const [source, setSource] = useState('');
  const [stage, setStage] = useState('');
  const [model, setModel] = useState('');
  const [tab, setTab] = useState<Tab>('overview');
  const [pivot, setPivot] = useState<Pivot>('stage');
  const [data, setData] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const params = useMemo(() => {
    const r = RANGES[range]!;
    const to = new Date();
    const from = new Date(to.getTime() - r.days * DAY);
    const [service, mdl] = model ? model.split('|') : [undefined, undefined];
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      bucket: r.bucket satisfies UsageBucket,
      dataset: dataset || undefined,
      source: source || undefined,
      stage: stage || undefined,
      service,
      model: mdl,
    };
  }, [range, dataset, source, stage, model]);

  const load = useCallback(async () => {
    const projectId = selectedProject?.id;
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<UsageSummary>(
        `/dashboard/projects/${projectId}/usage`,
        { params },
      );
      setData(res.data);
    } catch {
      setError('Could not load usage');
    } finally {
      setLoading(false);
    }
  }, [selectedProject?.id, params]);

  useEffect(() => {
    load();
  }, [load]);

  // Filter options come from the unfiltered dimensions of the current result,
  // so the page needs no extra endpoint.
  const options = useMemo(() => {
    const b = data?.breakdown ?? [];
    const uniq = (xs: (string | null)[]) =>
      [...new Set(xs.filter((x): x is string => Boolean(x)))].sort();
    return {
      stages: uniq(b.map((r) => r.stage)),
      models: uniq(
        b.map((r) => (r.service ? `${r.service}|${r.model}` : null)),
      ),
      datasets: (data?.byDataset ?? [])
        .map((d) => d.key)
        .filter((k): k is string => Boolean(k)),
    };
  }, [data]);

  if (!selectedProject) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Select a project.</div>
    );
  }

  const t = data?.totals;
  const mem = data?.memory;
  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'breakdown', label: 'Breakdown' },
    { id: 'memory', label: 'Memory' },
    { id: 'logs', label: 'Logs' },
  ];

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Usage</h1>
          <p className="text-sm text-muted-foreground mt-1">
            What the platform spent on {selectedProject.name}: model calls,
            embeddings, latency, and memory growth.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw
            className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
          />
          Refresh
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select<string>
          value={String(range)}
          onValueChange={(v) => setRange(Number(v ?? 0))}
        >
          <SelectTrigger className="h-8 w-auto min-w-36 text-xs">
            <SelectValue>Last {RANGES[range]!.label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {RANGES.map((r, i) => (
              <SelectItem key={r.label} value={String(i)} className="text-xs">
                Last {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Filter
          value={dataset}
          onChange={setDataset}
          all="All datasets"
          options={options.datasets.map((d) => ({ value: d, label: d }))}
        />
        <Filter
          value={source}
          onChange={setSource}
          all="All sources"
          options={[
            { value: 'api', label: 'API (SDK)' },
            { value: 'dashboard', label: 'Dashboard' },
            { value: 'worker', label: 'Worker' },
          ]}
        />
        <Filter
          value={stage}
          onChange={setStage}
          all="All stages"
          options={options.stages.map((s) => ({ value: s, label: s }))}
        />
        <Filter
          value={model}
          onChange={setModel}
          all="All models"
          options={options.models.map((m) => ({
            value: m,
            label: m.replace('|', ' / '),
          }))}
        />
        {(dataset || source || stage || model) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDataset('');
              setSource('');
              setStage('');
              setModel('');
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) =>
          setTab(tabs.find((x) => x.id === v)?.id ?? 'overview')
        }
      >
        <TabsList className="h-9">
          {tabs.map((x) => (
            <TabsTrigger key={x.id} value={x.id} className="px-4">
              {x.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {tab === 'overview' && t && mem && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tile
              label="Cost"
              value={fmtUsd(t.costUsd)}
              sub={
                t.unpriced
                  ? 'some calls unpriced'
                  : 'from token counts × price table'
              }
            />
            <Tile
              label="Tokens"
              value={fmtTokens(t.inputTokens + t.outputTokens)}
              sub={`${fmtTokens(t.inputTokens)} in · ${fmtTokens(t.outputTokens)} out`}
            />
            <Tile
              label="Calls"
              value={fmtInt(t.calls)}
              sub={`${t.errors} errors · ${pct(t.errors, t.calls)}`}
            />
            <Tile
              label="Latency"
              value={fmtMs(t.p95LatencyMs)}
              sub={`p95 · p50 ${fmtMs(t.p50LatencyMs)}`}
            />
            <Tile
              label="Live facts"
              value={fmtInt(mem.factsLive)}
              sub={`${fmtInt(mem.factsInvalidated)} invalidated`}
            />
            <Tile
              label="Episodes"
              value={fmtInt(
                Object.values(mem.episodes).reduce((a, b) => a + b, 0),
              )}
              sub={
                Object.entries(mem.episodes)
                  .map(([k, v]) => `${v} ${k}`)
                  .join(' · ') || '—'
              }
            />
            <Tile
              label="Threads"
              value={fmtInt(mem.threads)}
              sub={`${fmtInt(mem.messages)} messages · ${mem.datasets} datasets`}
            />
            <Tile
              label="Stored message tokens"
              value={fmtTokens(mem.messageTokens)}
              sub="reported by your app, not platform spend"
            />
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <UsageChart
              type="line"
              title={`Cost per ${data!.bucket}`}
              info="Estimated USD the platform spent on model and embedding calls in each period, from token counts × the price table. Spans are free."
              rows={data!.timeseries.map((r) => ({
                bucket: r.bucket,
                value: r.costUsd,
              }))}
              format={fmtUsd}
            />
            <UsageChart
              type="line"
              title={`Tokens per ${data!.bucket}`}
              info="Input + output tokens sent to and returned by language models in each period. Embeddings count by characters, not here."
              rows={data!.timeseries.map((r) => ({
                bucket: r.bucket,
                value: r.inputTokens + r.outputTokens,
              }))}
              format={fmtTokens}
            />
            <UsageChart
              title={`Calls per ${data!.bucket}`}
              info="Logged units of work in each period: model calls, embedding batches and timed spans (recalls, episodes, HTTP requests)."
              rows={data!.timeseries.map((r) => ({
                bucket: r.bucket,
                value: r.calls,
              }))}
              format={fmtInt}
            />
            <UsageChart
              title={`Errors per ${data!.bucket}`}
              info="Calls that failed in each period: model timeouts, embedding failures, and HTTP 5xx responses."
              rows={data!.timeseries.map((r) => ({
                bucket: r.bucket,
                value: r.errors,
              }))}
              format={fmtInt}
            />
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <KeyTable
              title="By dataset"
              rows={data!.byDataset.map((r) => ({
                ...r,
                label: r.key ?? '— (no dataset)',
              }))}
            />
            <KeyTable
              title="By API key"
              rows={data!.byApiKey.map((r) => ({
                ...r,
                label:
                  r.label ??
                  (r.key ? r.key.slice(0, 8) : '— (dashboard / worker)'),
              }))}
            />
          </div>
        </div>
      )}

      {tab === 'breakdown' && data && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Group by</span>
            <Select<string>
              value={pivot}
              onValueChange={(v) =>
                setPivot(PIVOTS.find((p) => p === v) ?? 'stage')
              }
            >
              <SelectTrigger className="h-8 w-auto min-w-36 text-xs">
                <SelectValue>{PIVOT_LABELS[pivot]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PIVOTS.map((p) => (
                  <SelectItem key={p} value={p} className="text-xs">
                    {PIVOT_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-lg border border-border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <Th>{PIVOT_LABELS[pivot]}</Th>
                  <Th right>Calls</Th>
                  <Th right>Errors</Th>
                  <Th right>In tokens</Th>
                  <Th right>Out tokens</Th>
                  <Th right>Cost</Th>
                  <Th right>p50</Th>
                  <Th right>p95</Th>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pivotRows(data.breakdown, pivot).map((r) => (
                  <TableRow key={r.name}>
                    <Td mono>{r.name}</Td>
                    <Td right>{fmtInt(r.calls)}</Td>
                    <Td right>{r.errors}</Td>
                    <Td right>{fmtTokens(r.inputTokens)}</Td>
                    <Td right>{fmtTokens(r.outputTokens)}</Td>
                    <Td right>
                      {r.unpriced ? `${fmtUsd(r.costUsd)}*` : fmtUsd(r.costUsd)}
                    </Td>
                    <Td right>{fmtMs(Math.round(r.p50LatencyMs ?? 0))}</Td>
                    <Td right>{fmtMs(r.p95LatencyMs)}</Td>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {data.breakdown.length === 0 && (
              <div className="p-4 text-xs text-muted-foreground">
                No usage in this window.
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            * includes calls with no price entry. Spans (kind = span) are timing
            only and cost nothing.
          </p>
        </div>
      )}

      {tab === 'memory' && data && (
        <div className="grid md:grid-cols-2 gap-3">
          {MEMORY_SERIES.map(({ key, info }) => (
            <UsageChart
              key={key}
              title={`New ${key} per ${data.bucket}`}
              info={info}
              rows={data.memoryGrowth.map((r) => ({
                bucket: r.bucket,
                value: r[key],
              }))}
              format={fmtInt}
            />
          ))}
        </div>
      )}

      {tab === 'logs' && (
        <Logs projectId={selectedProject.id} params={params} />
      )}
    </div>
  );
}

function KeyTable({
  title,
  rows,
}: {
  title: string;
  rows: {
    key: string | null;
    label: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }[];
}) {
  return (
    <div className="rounded-lg border border-border overflow-x-auto">
      <div className="px-3 py-2 text-sm font-medium border-b border-border">
        {title}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <Th>Name</Th>
            <Th right>Calls</Th>
            <Th right>Tokens</Th>
            <Th right>Cost</Th>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key ?? '∅'}>
              <Td mono>{r.label}</Td>
              <Td right>{fmtInt(r.calls)}</Td>
              <Td right>{fmtTokens(r.inputTokens + r.outputTokens)}</Td>
              <Td right>{fmtUsd(r.costUsd)}</Td>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length === 0 && (
        <div className="p-3 text-xs text-muted-foreground">Nothing yet.</div>
      )}
    </div>
  );
}

function Logs({
  projectId,
  params,
}: {
  projectId: string;
  params: Record<string, string | undefined>;
}) {
  const [rows, setRows] = useState<UsageLogRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (after: string | null) => {
      setLoading(true);
      try {
        const res = await api.get<UsageLogsResponse>(
          `/dashboard/projects/${projectId}/usage/logs`,
          { params: { ...params, limit: 50, cursor: after ?? undefined } },
        );
        setRows((prev) =>
          after ? [...prev, ...res.data.logs] : res.data.logs,
        );
        setCursor(res.data.nextCursor);
      } finally {
        setLoading(false);
      }
    },
    [projectId, params],
  );

  useEffect(() => {
    load(null);
  }, [load]);

  return (
    <div className="rounded-lg border border-border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <Th> </Th>
            <Th>Time</Th>
            <Th>Source</Th>
            <Th>Operation</Th>
            <Th>Stage</Th>
            <Th>Model</Th>
            <Th right>In</Th>
            <Th right>Out</Th>
            <Th right>Cost</Th>
            <Th right>Latency</Th>
            <Th>OK</Th>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <UsageRowView
              key={r.id}
              row={r}
              open={open === r.id}
              toggle={() => setOpen(open === r.id ? null : r.id)}
            />
          ))}
        </TableBody>
      </Table>
      {rows.length === 0 && !loading && (
        <div className="p-4 text-xs text-muted-foreground">
          No log rows in this window.
        </div>
      )}
      {cursor && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full rounded-none border-t border-border"
          onClick={() => load(cursor)}
          disabled={loading}
        >
          {loading ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </div>
  );
}

function UsageRowView({
  row,
  open,
  toggle,
}: {
  row: UsageLogRow;
  open: boolean;
  toggle: () => void;
}) {
  const detail = {
    requestId: row.requestId,
    dataset: row.dataset,
    apiKeyId: row.apiKeyId,
    userId: row.userId,
    threadId: row.threadId,
    episodeId: row.episodeId,
    service: row.service,
    inputChars: row.inputChars,
    calls: row.calls,
    error: row.error,
    meta: row.meta,
  };
  return (
    <>
      <TableRow onClick={toggle} className="cursor-pointer">
        <Td>
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </Td>
        <Td mono>{new Date(row.createdAt).toLocaleString()}</Td>
        <Td>{row.source}</Td>
        <Td mono>{row.operation}</Td>
        <Td mono>{row.stage}</Td>
        <Td mono>{row.model ?? '—'}</Td>
        <Td right>{fmtTokens(row.inputTokens)}</Td>
        <Td right>{fmtTokens(row.outputTokens)}</Td>
        <Td right>{row.costUsd === null ? '—' : fmtUsd(row.costUsd)}</Td>
        <Td right>{fmtMs(row.latencyMs)}</Td>
        <Td>{row.ok ? '✓' : <span className="text-destructive">✗</span>}</Td>
      </TableRow>
      {open && (
        <TableRow>
          <TableCell colSpan={11} className="px-4 py-3 bg-muted/30">
            <pre className="text-xs font-mono whitespace-pre-wrap">
              {JSON.stringify(detail, null, 2)}
            </pre>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

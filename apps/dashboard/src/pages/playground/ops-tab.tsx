import { useEffect, useRef, useState } from 'react';
import type { RecallResponse } from '@memory-soda/types';
import type { Operation } from './types';
import { JsonBlock } from './json-block';
import { FactRow } from './fact-row';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

const OP_STYLE = {
  borderColor: 'border-border',
  bgColor: 'bg-background hover:bg-muted/40',
};
const ERROR_OP_STYLE = {
  borderColor: 'border-destructive',
  bgColor: 'bg-destructive/5 hover:bg-destructive/10',
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function opMeta(op: Operation): {
  label: string;
  subtitle: string;
  borderColor: string;
  bgColor: string;
  icon: string;
} {
  const d = op.summary;

  switch (op.type) {
    case 'thread_created':
      return {
        label: 'Thread created',
        subtitle: `id: ${String(d['threadId']).slice(0, 8)}… · auto-compact: ${d['autoCompact']}`,
        ...OP_STYLE,
        icon: '✦',
      };
    case 'message_added':
      return {
        label: 'Message added',
        subtitle: `role: ${d['role']} · seq: ${d['sequenceNumber']}${d['compacted'] ? ' · auto-compacted' : ''}`,
        ...OP_STYLE,
        icon: '→',
      };
    case 'manual_message_added':
      return {
        label: 'Raw message added',
        subtitle: `role: ${d['role']} · seq: ${d['sequenceNumber']} · no AI reply`,
        ...OP_STYLE,
        icon: '+',
      };
    case 'ai_replied':
      return {
        label: 'AI replied',
        subtitle: `seq: ${d['sequenceNumber']} · ${String(d['preview']).slice(0, 55)}${String(d['preview']).length > 55 ? '…' : ''}`,
        ...OP_STYLE,
        icon: '✦',
      };
    case 'prepare':
      return {
        label: 'Prepare',
        subtitle: `${d['messageCount']} msgs · compacted: ${d['compacted']}${d['truncated'] ? ' · truncated' : ''}${d['episodes'] ? ` · ${d['episodes']} episodes` : ''}${d['facts'] ? ` · ${d['facts']} facts` : ''}`,
        ...OP_STYLE,
        icon: '⟳',
      };
    case 'recall':
      return {
        label: 'Recall',
        subtitle: `${d['factCount']} facts${d['newFacts'] ? ` (${d['newFacts']} new)` : ''} · ${d['contextChars']} chars${d['synthesis'] ? ' · synthesis' : ''}${d['episodes'] ? ` · ${d['episodes']} episodes` : ''}`,
        ...OP_STYLE,
        icon: '⟳',
      };
    case 'auto_compacted':
      return {
        label: 'Auto-compacted',
        subtitle:
          String(d['summary']).slice(0, 60) +
          (String(d['summary']).length > 60 ? '…' : ''),
        ...OP_STYLE,
        icon: '⊙',
      };
    case 'compacted':
      return {
        label: 'Manual compact',
        subtitle: `${d['compactedCount']} msgs · seq ${d['fromSequence']}–${d['toSequence']}`,
        ...OP_STYLE,
        icon: '⊙',
      };
    case 'thread_ended':
      return {
        label: 'Thread ended',
        subtitle: `episodeQueued: ${d['episodeQueued']}`,
        ...OP_STYLE,
        icon: '✓',
      };
    case 'episode_scheduled':
      return {
        label: 'Episode timer reset',
        subtitle: 'Will generate after inactivity window',
        ...OP_STYLE,
        icon: '⏱',
      };
    case 'episodes_loaded':
      return {
        label: 'Episodes fetched',
        subtitle: `${d['count']} episode${Number(d['count']) !== 1 ? 's' : ''} loaded`,
        ...OP_STYLE,
        icon: '↓',
      };
    case 'episode_search':
      return {
        label: 'Episode search',
        subtitle: `"${String(d['q']).slice(0, 40)}" · ${d['count']} hit${Number(d['count']) !== 1 ? 's' : ''}`,
        ...OP_STYLE,
        icon: '⌕',
      };
    case 'episode_retried':
      return {
        label: 'Episode retry',
        subtitle: `id: ${String(d['episodeId']).slice(0, 8)}… · re-queued`,
        ...OP_STYLE,
        icon: '↺',
      };
    case 'episode_deleted':
      return {
        label: 'Episode deleted',
        subtitle: `id: ${String(d['episodeId']).slice(0, 8)}… · soft-deleted`,
        ...OP_STYLE,
        icon: '−',
      };
    case 'episode_failed':
      return {
        label: 'Episode failed',
        subtitle: String(d['message']).slice(0, 70),
        ...ERROR_OP_STYLE,
        icon: '✕',
      };
    case 'facts_extracted':
      return {
        label: `Facts extracted (${d['count']})`,
        subtitle: `episode ${String(d['episodeId']).slice(0, 8)}… · semantic pipeline complete`,
        ...OP_STYLE,
        icon: '◆',
      };
    case 'fact_deleted':
      return {
        label: 'Fact deleted',
        subtitle: `id: ${String(d['factId']).slice(0, 8)}… · invalidAt stamped`,
        ...OP_STYLE,
        icon: '−',
      };
    case 'note':
      return {
        label: 'Note',
        subtitle: String(d['message']),
        ...OP_STYLE,
        icon: 'ℹ',
      };
    case 'error':
      return {
        label: 'Error',
        subtitle: String(d['message']),
        ...ERROR_OP_STYLE,
        icon: '✕',
      };
  }
}

/** Which facts the model saw this turn that it had not seen on a previous one. */
function RecallDetail({ op }: { op: Operation }) {
  const res = op.response as { recall?: RecallResponse | null } | undefined;
  const facts = res?.recall?.facts;
  if (!facts?.length) return null;
  const fresh = new Set(
    (op.summary['newFactIds'] as string[] | undefined) ?? [],
  );
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
        Facts in context · {fresh.size} new
      </div>
      <ul className="space-y-1">
        {facts.map((f) => (
          <FactRow
            key={f.factId}
            fact={f}
            threshold={null}
            badge={fresh.has(f.factId) ? 'new' : undefined}
          />
        ))}
      </ul>
    </div>
  );
}

// ── Turn grouping ─────────────────────────────────────────────────────────────

interface Turn {
  ops: Operation[];
  /** Wall time of the chat request, when the turn has one. */
  durationMs: number | undefined;
  summary: string;
}

/** Group ops so a chat turn (message → prepare → recall → reply) reads as one row. */
function groupTurns(ops: Operation[]): Turn[] {
  const turns: Turn[] = [];
  let cur: Operation[] = [];
  const flush = () => {
    if (!cur.length) return;
    const head = cur[0]!;
    const isTurn = head.type === 'message_added';
    const pieces: string[] = [];
    for (const o of cur) {
      const d = o.summary;
      if (o.type === 'prepare')
        pieces.push(`prepare ${d['messageCount']} msgs`);
      if (o.type === 'recall')
        pieces.push(
          `recall ${d['factCount']} facts${d['episodes'] ? ` · ${d['episodes']} eps` : ''}`,
        );
      if (o.type === 'auto_compacted') pieces.push('compacted');
      if (o.type === 'facts_extracted')
        pieces.push(`+${d['count']} facts extracted`);
      if (o.type === 'error') pieces.push('error');
    }
    turns.push({
      ops: cur,
      durationMs: isTurn ? head.durationMs : undefined,
      summary: pieces.join(' → '),
    });
    cur = [];
  };
  for (const op of ops) {
    if (op.type === 'message_added' || op.type === 'manual_message_added')
      flush();
    cur.push(op);
  }
  flush();
  return turns;
}

function TurnGroup({
  turn,
  index,
  maxMs,
  relTime,
  defaultOpen,
}: {
  turn: Turn;
  index: number;
  maxMs: number;
  relTime: (ts: number) => string;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const hasError = turn.ops.some(
    (o) => o.type === 'error' || o.type === 'episode_failed',
  );
  const isTurn = turn.ops[0]?.type === 'message_added';
  return (
    <div className="space-y-1.5">
      <Button
        variant="ghost"
        size="xs"
        className="w-full justify-start px-1 text-[10px] text-muted-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <span className="font-mono">{open ? '▾' : '▸'}</span>
          <span className="font-medium text-foreground">
            {isTurn ? `Turn ${index}` : 'Setup'}
          </span>
          <span className="truncate">{turn.summary}</span>
          {hasError && <span className="text-destructive">error</span>}
          {turn.durationMs !== undefined && (
            <span className="ml-auto font-mono shrink-0">
              {formatDuration(turn.durationMs)}
            </span>
          )}
        </div>
        {turn.durationMs !== undefined && maxMs > 0 && (
          <div className="mt-1 h-0.5 bg-muted rounded-full">
            <div
              className="h-full bg-foreground rounded-full"
              style={{
                width: `${Math.max(2, (turn.durationMs / maxMs) * 100)}%`,
              }}
            />
          </div>
        )}
      </Button>
      {open &&
        turn.ops.map((op) => (
          <OperationEntry key={op.id} op={op} relTime={relTime(op.ts)} />
        ))}
    </div>
  );
}

function exportOps(ops: Operation[]) {
  const blob = new Blob([JSON.stringify(ops, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `memory-soda-ops-${new Date().toISOString().slice(0, 19)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function OperationEntry({ op, relTime }: { op: Operation; relTime: string }) {
  const [expanded, setExpanded] = useState(false);

  const { label, subtitle, borderColor, bgColor, icon } = opMeta(op);
  const timing =
    op.durationMs !== undefined ? formatDuration(op.durationMs) : relTime;

  return (
    <div
      className={`rounded-md border border-l-2 text-xs cursor-pointer select-none ${borderColor} ${bgColor}`}
      onClick={() => setExpanded((v) => !v)}
    >
      <div className="flex items-start gap-2 px-3 py-2">
        <span className="font-mono shrink-0 text-[11px] mt-0.5">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-medium text-foreground">{label}</span>
            <span className="text-[10px] text-muted-foreground font-mono shrink-0">
              {timing}
            </span>
          </div>
          {subtitle && (
            <p className="text-muted-foreground mt-0.5 truncate">{subtitle}</p>
          )}
        </div>
        <span className="text-muted-foreground text-[10px] shrink-0 mt-0.5">
          {expanded ? '▾' : '▸'}
        </span>
      </div>

      {expanded && (
        <div
          className="border-t border-border/50 mx-3 mb-2 pt-2 space-y-2 cursor-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {op.request && (
            <div className="text-[10px] font-mono text-muted-foreground break-all">
              <span className="font-semibold">{op.request.method}</span>{' '}
              {op.request.path}
              {op.durationMs !== undefined && (
                <span> · {formatDuration(op.durationMs)}</span>
              )}
            </div>
          )}
          {op.type === 'recall' && <RecallDetail op={op} />}
          {op.request?.body !== undefined && (
            <JsonBlock label="Request" value={op.request.body} />
          )}
          {op.response !== undefined && op.response !== null && (
            <JsonBlock label="Response" value={op.response} />
          )}
          {!op.request &&
            (op.response === undefined || op.response === null) && (
              <JsonBlock label="Data" value={op.summary} />
            )}
        </div>
      )}
    </div>
  );
}

/** Bookkeeping ops that describe the playground, not the API. */
const BACKGROUND_OPS = new Set<Operation['type']>([
  'episode_scheduled',
  'episodes_loaded',
  'note',
]);

export function OpsTab({
  ops,
  relTime,
  onClear,
}: {
  ops: Operation[];
  relTime: (ts: number) => string;
  onClear: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const [apiOnly, setApiOnly] = useState(false);
  const shown = apiOnly ? ops.filter((o) => !BACKGROUND_OPS.has(o.type)) : ops;
  const turns = groupTurns(shown);
  // Setup rows don't count; number only real chat turns.
  let n = 0;
  const turnIndex = turns.map((t) =>
    t.ops[0]?.type === 'message_added' ? ++n : 0,
  );
  const maxMs = Math.max(0, ...turns.map((t) => t.durationMs ?? 0));
  const errors = ops.filter(
    (o) => o.type === 'error' || o.type === 'episode_failed',
  ).length;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [ops]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {ops.length > 0 && (
        <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border text-[10px] text-muted-foreground shrink-0">
          <span className="font-mono">
            {shown.length} op{shown.length !== 1 ? 's' : ''}
            {errors > 0 && (
              <span className="text-destructive">
                {' '}
                · {errors} error{errors !== 1 ? 's' : ''}
              </span>
            )}
          </span>
          <label className="flex items-center gap-1 cursor-pointer ml-auto">
            <Checkbox
              checked={apiOnly}
              onCheckedChange={(v) => setApiOnly(v === true)}
            />
            API calls only
          </label>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => exportOps(ops)}
            title="Download the ops log as JSON"
          >
            export
          </Button>
          <Button variant="ghost" size="xs" onClick={onClear}>
            clear
          </Button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto min-h-0">
        {ops.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-xs text-muted-foreground text-center px-4">
            Operations will appear here as you interact with the thread. Expand
            any entry to see the full request and response payloads.
          </div>
        ) : (
          <div className="p-2 space-y-1.5">
            {turns.map((turn, i) => (
              <TurnGroup
                key={turn.ops[0]!.id}
                turn={turn}
                index={turnIndex[i]!}
                maxMs={maxMs}
                relTime={relTime}
                defaultOpen={i === turns.length - 1}
              />
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>
    </div>
  );
}

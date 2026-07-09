import { useEffect, useRef, useState } from 'react';
import type { Operation } from './types';
import { JsonBlock } from './json-block';

// One constant per color family — Tailwind purge needs the literal classes.
const VIOLET_OP_STYLE = {
  borderColor: 'border-violet-400 dark:border-violet-600',
  bgColor:
    'bg-violet-50/60 dark:bg-violet-950/20 hover:bg-violet-50 dark:hover:bg-violet-950/30',
  icon: '⟳',
};

const ORANGE_OP_STYLE = {
  borderColor: 'border-orange-400 dark:border-orange-600',
  bgColor:
    'bg-orange-50/60 dark:bg-orange-950/20 hover:bg-orange-50 dark:hover:bg-orange-950/30',
  icon: '⊙',
};

const RED_OP_STYLE = {
  borderColor: 'border-red-400 dark:border-red-600',
  bgColor:
    'bg-red-50/60 dark:bg-red-950/20 hover:bg-red-50 dark:hover:bg-red-950/30',
  icon: '✕',
};

const EMERALD_OP_STYLE = {
  borderColor: 'border-emerald-400 dark:border-emerald-600',
  bgColor:
    'bg-emerald-50/60 dark:bg-emerald-950/20 hover:bg-emerald-50 dark:hover:bg-emerald-950/30',
  icon: '✦',
};

const INDIGO_OP_STYLE = {
  borderColor: 'border-indigo-400 dark:border-indigo-600',
  bgColor:
    'bg-indigo-50/60 dark:bg-indigo-950/20 hover:bg-indigo-50 dark:hover:bg-indigo-950/30',
  icon: '↓',
};

const BLUE_OP_STYLE = {
  borderColor: 'border-blue-400 dark:border-blue-600',
  bgColor:
    'bg-blue-50/60 dark:bg-blue-950/20 hover:bg-blue-50 dark:hover:bg-blue-950/30',
  icon: '→',
};

const TEAL_OP_STYLE = {
  borderColor: 'border-teal-400 dark:border-teal-600',
  bgColor:
    'bg-teal-50/60 dark:bg-teal-950/20 hover:bg-teal-50 dark:hover:bg-teal-950/30',
  icon: '✦',
};

const GREEN_OP_STYLE = {
  borderColor: 'border-green-400 dark:border-green-600',
  bgColor:
    'bg-green-50/60 dark:bg-green-950/20 hover:bg-green-50 dark:hover:bg-green-950/30',
  icon: '✓',
};

const PURPLE_OP_STYLE = {
  borderColor: 'border-purple-400 dark:border-purple-600',
  bgColor:
    'bg-purple-50/60 dark:bg-purple-950/20 hover:bg-purple-50 dark:hover:bg-purple-950/30',
  icon: '⏱',
};

const SLATE_OP_STYLE = {
  borderColor: 'border-slate-300 dark:border-slate-600',
  bgColor:
    'bg-slate-50/60 dark:bg-slate-950/20 hover:bg-slate-50 dark:hover:bg-slate-950/30',
  icon: 'ℹ',
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
        ...EMERALD_OP_STYLE,
      };
    case 'message_added':
      return {
        label: 'Message added',
        subtitle: `role: ${d['role']} · seq: ${d['sequenceNumber']}${d['compacted'] ? ' · auto-compacted' : ''}`,
        ...BLUE_OP_STYLE,
      };
    case 'manual_message_added':
      return {
        label: 'Raw message added',
        subtitle: `role: ${d['role']} · seq: ${d['sequenceNumber']} · no AI reply`,
        ...BLUE_OP_STYLE,
        icon: '+',
      };
    case 'ai_replied':
      return {
        label: 'AI replied',
        subtitle: `seq: ${d['sequenceNumber']} · ${String(d['preview']).slice(0, 55)}${String(d['preview']).length > 55 ? '…' : ''}`,
        ...TEAL_OP_STYLE,
      };
    case 'prepare':
      return {
        label: 'Prepare',
        subtitle: `${d['messageCount']} msgs · compacted: ${d['compacted']}${d['truncated'] ? ' · truncated' : ''}${d['episodes'] ? ` · ${d['episodes']} episodes` : ''}${d['facts'] ? ` · ${d['facts']} facts` : ''}`,
        ...VIOLET_OP_STYLE,
      };
    case 'recall':
      return {
        label: 'Recall',
        subtitle: `${d['factCount']} facts · ${d['contextChars']} chars${d['synthesis'] ? ' · synthesis' : ''}${d['episodes'] ? ` · ${d['episodes']} episodes` : ''}`,
        ...VIOLET_OP_STYLE,
      };
    case 'auto_compacted':
      return {
        label: 'Auto-compacted',
        subtitle:
          String(d['summary']).slice(0, 60) +
          (String(d['summary']).length > 60 ? '…' : ''),
        ...ORANGE_OP_STYLE,
      };
    case 'compacted':
      return {
        label: 'Manual compact',
        subtitle: `${d['compactedCount']} msgs · seq ${d['fromSequence']}–${d['toSequence']}`,
        ...ORANGE_OP_STYLE,
      };
    case 'thread_ended':
      return {
        label: 'Thread ended',
        subtitle: `episodeQueued: ${d['episodeQueued']}`,
        ...GREEN_OP_STYLE,
      };
    case 'episode_scheduled':
      return {
        label: 'Episode timer reset',
        subtitle: 'Will generate after inactivity window',
        ...PURPLE_OP_STYLE,
      };
    case 'episodes_loaded':
      return {
        label: 'Episodes fetched',
        subtitle: `${d['count']} episode${Number(d['count']) !== 1 ? 's' : ''} loaded`,
        ...INDIGO_OP_STYLE,
      };
    case 'episode_search':
      return {
        label: 'Episode search',
        subtitle: `"${String(d['q']).slice(0, 40)}" · ${d['count']} hit${Number(d['count']) !== 1 ? 's' : ''}`,
        ...INDIGO_OP_STYLE,
        icon: '⌕',
      };
    case 'episode_retried':
      return {
        label: 'Episode retry',
        subtitle: `id: ${String(d['episodeId']).slice(0, 8)}… · re-queued`,
        ...PURPLE_OP_STYLE,
        icon: '↺',
      };
    case 'episode_deleted':
      return {
        label: 'Episode deleted',
        subtitle: `id: ${String(d['episodeId']).slice(0, 8)}… · soft-deleted`,
        ...ORANGE_OP_STYLE,
        icon: '−',
      };
    case 'episode_failed':
      return {
        label: 'Episode failed',
        subtitle: String(d['message']).slice(0, 70),
        ...RED_OP_STYLE,
      };
    case 'facts_extracted':
      return {
        label: `Facts extracted (${d['count']})`,
        subtitle: `episode ${String(d['episodeId']).slice(0, 8)}… · semantic pipeline complete`,
        ...EMERALD_OP_STYLE,
        icon: '◆',
      };
    case 'fact_deleted':
      return {
        label: 'Fact deleted',
        subtitle: `id: ${String(d['factId']).slice(0, 8)}… · invalidAt stamped`,
        ...ORANGE_OP_STYLE,
        icon: '−',
      };
    case 'note':
      return {
        label: 'Note',
        subtitle: String(d['message']),
        ...SLATE_OP_STYLE,
      };
    case 'error':
      return {
        label: 'Error',
        subtitle: String(d['message']),
        ...RED_OP_STYLE,
      };
  }
}

function OperationEntry({ op, relTime }: { op: Operation; relTime: string }) {
  const [expanded, setExpanded] = useState(false);

  const { label, subtitle, borderColor, bgColor, icon } = opMeta(op);
  const timing =
    op.durationMs !== undefined ? formatDuration(op.durationMs) : relTime;

  return (
    <div
      className={`rounded-md border-l-2 text-xs cursor-pointer select-none ${borderColor} ${bgColor}`}
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
          {op.request?.body !== undefined && (
            <JsonBlock label="Request" value={op.request.body} />
          )}
          {op.response !== undefined && op.response !== null && (
            <JsonBlock label="Response" value={op.response} />
          )}
          {!op.request && (op.response === undefined || op.response === null) && (
            <JsonBlock label="Data" value={op.summary} />
          )}
        </div>
      )}
    </div>
  );
}

export function OpsTab({
  ops,
  relTime,
}: {
  ops: Operation[];
  relTime: (ts: number) => string;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [ops]);

  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      {ops.length === 0 ? (
        <div className="flex items-center justify-center h-32 text-xs text-muted-foreground text-center px-4">
          Operations will appear here as you interact with the thread. Expand
          any entry to see the full request and response payloads.
        </div>
      ) : (
        <div className="p-2 space-y-1.5">
          {ops.map((op) => (
            <OperationEntry key={op.id} op={op} relTime={relTime(op.ts)} />
          ))}
          <div ref={endRef} />
        </div>
      )}
    </div>
  );
}

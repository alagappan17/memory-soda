import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import type {
  ProjectEpisodicSettings,
  ProjectSemanticSettings,
} from '@memory-soda/types';
import { getProjectSettings } from '../../lib/api';
import type { WMSettings } from './types';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

function Toggle({
  on,
  onClick,
  disabled,
  title,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <Switch
      checked={on}
      onCheckedChange={onClick}
      disabled={disabled}
      title={title}
    />
  );
}

function PanelShell({
  title,
  defaultOpen,
  children,
}: {
  title: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border shrink-0">
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-full justify-start gap-1.5 rounded-none px-4 text-xs md:text-xs font-medium text-muted-foreground bg-card"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="font-mono">{open ? '▾' : '▸'}</span>
        {title}
      </Button>
      {open && (
        <div className="px-4 pb-4 pt-1 bg-card space-y-3">{children}</div>
      )}
    </div>
  );
}

// ── Shared rows ───────────────────────────────────────────────────────────────

/**
 * Settings that travel with the thread are sent once, on threads.create(),
 * and the server never reads them again. The panel says so up front and locks
 * each such row, instead of a tooltip nobody hovers.
 */
function FrozenNotice({ what }: { what: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-muted/50 px-2.5 py-2 text-[10px] text-muted-foreground">
      <Lock className="mt-px size-3 shrink-0" />
      <span>
        Thread active. {what} were fixed when this thread was created and cannot
        be changed now. Start a new thread to use different values.
      </span>
    </div>
  );
}

function Row({
  label,
  hint,
  frozen,
  off,
  children,
}: {
  label: string;
  hint?: string;
  /** Sent on thread creation; locked while a thread is active. */
  frozen?: boolean;
  /** The feature that owns this row is switched off. */
  off?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 ${frozen || off ? 'opacity-60' : ''}`}
      title={
        frozen ? 'Fixed for this thread' : off ? 'Enable to edit' : undefined
      }
    >
      <label className="text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          {label}
          {frozen && <Lock className="size-2.5" />}
        </span>
        {hint && <span className="block text-[10px] opacity-60">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

const NUM = 'h-7 w-20 text-right text-xs md:text-xs';

// ── Working memory ────────────────────────────────────────────────────────────

export function WorkingMemoryPanel({
  settings,
  onChange,
  hasThread,
}: {
  settings: WMSettings;
  onChange: (s: WMSettings) => void;
  hasThread: boolean;
}) {
  return (
    <PanelShell title="Working Memory" defaultOpen={true}>
      {hasThread && <FrozenNotice what="Auto-compact settings" />}

      <Row label="Auto-compact" frozen={hasThread}>
        <Toggle
          on={settings.autoCompactEnabled}
          onClick={() =>
            onChange({
              ...settings,
              autoCompactEnabled: !settings.autoCompactEnabled,
            })
          }
          disabled={hasThread}
        />
      </Row>

      <Row
        label="Compact threshold"
        hint="messages before compact"
        frozen={hasThread}
        off={!settings.autoCompactEnabled}
      >
        <Input
          type="number"
          min={2}
          max={500}
          value={settings.autoCompactThreshold}
          onChange={(e) =>
            onChange({
              ...settings,
              autoCompactThreshold: Math.max(
                2,
                parseInt(e.target.value, 10) || 2,
              ),
            })
          }
          disabled={hasThread || !settings.autoCompactEnabled}
          className={NUM}
        />
      </Row>

      <Row label="Message limit" hint="per prepare call, editable anytime">
        <Input
          type="number"
          min={1}
          max={100}
          value={settings.messageLimit}
          onChange={(e) =>
            onChange({
              ...settings,
              messageLimit: Math.max(
                1,
                Math.min(100, parseInt(e.target.value, 10) || 20),
              ),
            })
          }
          className={NUM}
        />
      </Row>

      {settings.autoCompactEnabled &&
        settings.messageLimit < settings.autoCompactThreshold && (
          <p className="text-[10px] text-destructive bg-destructive/10 rounded px-2 py-1">
            Message limit is below the compact threshold, messages between the
            summary and the tail will be skipped by prepare.
          </p>
        )}
    </PanelShell>
  );
}

// ── Episodic memory ───────────────────────────────────────────────────────────

export function EpisodicPanel({
  settings,
  onChange,
  hasThread,
}: {
  settings: ProjectEpisodicSettings;
  onChange: (s: ProjectEpisodicSettings) => void;
  hasThread: boolean;
}) {
  // Fixed once a thread exists, and pointless to edit while the feature is off.
  const off = !settings.enabled;
  const locked = hasThread || off;
  const number = (
    key: keyof ProjectEpisodicSettings,
    parse: (raw: string) => number,
  ) => (
    <Input
      type="number"
      disabled={locked}
      value={String(settings[key] ?? '')}
      onChange={(e) => onChange({ ...settings, [key]: parse(e.target.value) })}
      className={NUM}
    />
  );

  return (
    <PanelShell title="Episodic Memory" defaultOpen={true}>
      {hasThread && <FrozenNotice what="Episodic settings" />}

      <Row label="Enabled" frozen={hasThread}>
        <Toggle
          on={settings.enabled}
          onClick={() => onChange({ ...settings, enabled: !settings.enabled })}
          disabled={hasThread}
        />
      </Row>

      <Row
        label="Inactivity interval"
        hint="seconds · blank = disabled"
        frozen={hasThread}
        off={off}
      >
        <Input
          type="number"
          min={1}
          placeholder="off"
          disabled={locked}
          value={
            settings.autoEpisodeIntervalMs !== null
              ? settings.autoEpisodeIntervalMs / 1000
              : ''
          }
          onChange={(e) => {
            const val = e.target.value;
            onChange({
              ...settings,
              autoEpisodeIntervalMs:
                val === '' ? null : Math.max(1, parseInt(val) || 1) * 1000,
            });
          }}
          className={NUM}
        />
      </Row>

      <Row
        label="Max messages"
        hint="analyzed per episode"
        frozen={hasThread}
        off={off}
      >
        {number('maxMessages', (raw) => Math.max(1, parseInt(raw, 10) || 100))}
      </Row>

      <Row
        label="Max retries"
        hint="on extraction failure"
        frozen={hasThread}
        off={off}
      >
        {number('maxRetries', (raw) => Math.max(0, parseInt(raw, 10) || 0))}
      </Row>

      <Row
        label="Context episodes"
        hint="injected into recall"
        frozen={hasThread}
        off={off}
      >
        {number('contextEpisodes', (raw) =>
          Math.max(1, parseInt(raw, 10) || 3),
        )}
      </Row>

      <Row
        label="Similarity weight"
        hint="semantic vs recency (0–1)"
        frozen={hasThread}
        off={off}
      >
        <Input
          type="number"
          min={0}
          max={1}
          step={0.1}
          disabled={locked}
          value={settings.similarityWeight}
          onChange={(e) => {
            const val = Math.min(
              1,
              Math.max(0, parseFloat(e.target.value) || 0),
            );
            onChange({
              ...settings,
              similarityWeight: val,
              recencyWeight: Number((1 - val).toFixed(1)),
            });
          }}
          className={NUM}
        />
      </Row>

      <Row
        label="Recency weight"
        hint="auto (1 − similarity)"
        frozen={hasThread}
        off={off}
      >
        <span className="text-xs font-mono text-muted-foreground w-20 text-right pr-1">
          {settings.recencyWeight.toFixed(1)}
        </span>
      </Row>
    </PanelShell>
  );
}

// ── Semantic (project-level, read-only) ───────────────────────────────────────

const SEMANTIC_ROWS: {
  key: keyof ProjectSemanticSettings;
  label: string;
  hint: string;
}[] = [
  { key: 'enabled', label: 'Enabled', hint: 'fact extraction on/off' },
  {
    key: 'retrievalMinConfidence',
    label: 'Min confidence',
    hint: 'retrieval floor, all facts stored',
  },
  { key: 'factsInContext', label: 'Facts in context', hint: 'recall limit' },
  {
    key: 'entityResolutionThreshold',
    label: 'Entity resolution',
    hint: 'merge similarity',
  },
  { key: 'factDedupThreshold', label: 'Fact dedup', hint: 'duplicate cutoff' },
  {
    key: 'contradictionBandMin',
    label: 'Contradiction band',
    hint: 'invalidation floor',
  },
  {
    key: 'anchorVectorMin',
    label: 'Anchor vector min',
    hint: 'entity retrieval floor',
  },
  {
    key: 'anchorVectorTopK',
    label: 'Anchor top-K',
    hint: 'entities per query',
  },
];

export function SemanticPanel({
  projectId,
  semantic,
  onLoaded,
}: {
  projectId: string;
  semantic: ProjectSemanticSettings | null;
  onLoaded: (s: ProjectSemanticSettings) => void;
}) {
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    setError(false);
    getProjectSettings(projectId)
      .then((res) => onLoaded(res.settings.semantic))
      .catch(() => setError(true));
    // onLoaded is a state setter from the parent, stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  return (
    <PanelShell title="Semantic (project)" defaultOpen={false}>
      {!projectId ? (
        <p className="text-[10px] text-muted-foreground">
          Select a project to load settings.
        </p>
      ) : error ? (
        <p className="text-[10px] text-muted-foreground">
          Could not load project settings.
        </p>
      ) : !semantic ? (
        <p className="text-[10px] text-muted-foreground">Loading…</p>
      ) : (
        <>
          {SEMANTIC_ROWS.map(({ key, label, hint }) => (
            <div key={key} className="flex items-center justify-between">
              <label className="text-xs text-muted-foreground">
                {label}
                <span className="block text-[10px] opacity-60">{hint}</span>
              </label>
              <span className="text-xs font-mono text-muted-foreground">
                {String(semantic[key])}
              </span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground bg-muted/50 rounded px-2 py-1">
            Project-level, edit in{' '}
            <Link
              to={`/projects/${projectId}/settings`}
              className="underline hover:text-foreground"
            >
              Project Settings
            </Link>
            . Recall can override min confidence and limit per call.
          </p>
        </>
      )}
    </PanelShell>
  );
}

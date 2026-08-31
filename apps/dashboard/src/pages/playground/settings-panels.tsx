import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  ProjectEpisodicSettings,
  ProjectSemanticSettings,
} from '@memory-soda/types';
import { getProjectSettings } from '../../lib/api';
import type { WMSettings } from './types';

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
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
        on ? 'bg-primary' : 'bg-input'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-background transition-transform ${
          on ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
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
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors bg-card"
      >
        <span className="font-mono">{open ? '▾' : '▸'}</span>
        {title}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 bg-card space-y-3">{children}</div>
      )}
    </div>
  );
}

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
      <div className="flex items-center justify-between">
        <label className="text-xs text-muted-foreground">Auto-compact</label>
        <Toggle
          on={settings.autoCompactEnabled}
          onClick={() =>
            onChange({
              ...settings,
              autoCompactEnabled: !settings.autoCompactEnabled,
            })
          }
          disabled={hasThread}
          title={
            hasThread ? 'Cannot change after thread is started' : undefined
          }
        />
      </div>

      {settings.autoCompactEnabled && (
        <div className="flex items-center justify-between">
          <label className="text-xs text-muted-foreground">
            Compact threshold
            <span className="block text-[10px] opacity-60">
              messages before compact
            </span>
          </label>
          <input
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
            disabled={hasThread}
            className="w-20 text-right rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          />
        </div>
      )}

      <div className="flex items-center justify-between">
        <label className="text-xs text-muted-foreground">
          Message limit
          <span className="block text-[10px] opacity-60">
            messages fetched for prepare
          </span>
        </label>
        <input
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
          className="w-20 text-right rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {settings.autoCompactEnabled &&
        settings.messageLimit < settings.autoCompactThreshold && (
          <p className="text-[10px] text-destructive bg-destructive/10 rounded px-2 py-1">
            Message limit is below the compact threshold, messages between the
            summary and the tail will be skipped by prepare.
          </p>
        )}
      {hasThread && (
        <p className="text-[10px] text-muted-foreground bg-muted/50 rounded px-2 py-1">
          Thread active, start a new thread to change auto-compact.
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
  return (
    <PanelShell title="Episodic Memory" defaultOpen={true}>
      <div className="flex items-center justify-between">
        <label className="text-xs text-muted-foreground">Enabled</label>
        <Toggle
          on={settings.enabled}
          onClick={() => onChange({ ...settings, enabled: !settings.enabled })}
          disabled={hasThread}
        />
      </div>

      <div className="flex items-center justify-between">
        <label className="text-xs text-muted-foreground">
          Inactivity interval
          <span className="block text-[10px] opacity-60">
            seconds · blank = disabled
          </span>
        </label>
        <input
          type="number"
          min={1}
          placeholder="off"
          disabled={hasThread}
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
          className="w-20 text-right rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        />
      </div>

      <div className="flex items-center justify-between">
        <label className="text-xs text-muted-foreground">
          Max messages
          <span className="block text-[10px] opacity-60">
            analyzed per episode
          </span>
        </label>
        <input
          type="number"
          min={1}
          max={1000}
          disabled={hasThread}
          value={settings.maxMessages}
          onChange={(e) =>
            onChange({
              ...settings,
              maxMessages: Math.max(1, parseInt(e.target.value, 10) || 100),
            })
          }
          className="w-20 text-right rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        />
      </div>

      <div className="flex items-center justify-between">
        <label className="text-xs text-muted-foreground">
          Max retries
          <span className="block text-[10px] opacity-60">
            on extraction failure
          </span>
        </label>
        <input
          type="number"
          min={0}
          max={10}
          disabled={hasThread}
          value={settings.maxRetries}
          onChange={(e) =>
            onChange({
              ...settings,
              maxRetries: Math.max(0, parseInt(e.target.value, 10) || 0),
            })
          }
          className="w-20 text-right rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        />
      </div>

      <div className="flex items-center justify-between">
        <label className="text-xs text-muted-foreground">
          Context episodes
          <span className="block text-[10px] opacity-60">
            injected into recall
          </span>
        </label>
        <input
          type="number"
          min={1}
          max={20}
          disabled={hasThread}
          value={settings.contextEpisodes}
          onChange={(e) =>
            onChange({
              ...settings,
              contextEpisodes: Math.max(1, parseInt(e.target.value, 10) || 3),
            })
          }
          className="w-20 text-right rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        />
      </div>

      <div className="flex items-center justify-between">
        <label className="text-xs text-muted-foreground">
          Similarity weight
          <span className="block text-[10px] opacity-60">
            semantic vs recency (0–1)
          </span>
        </label>
        <input
          type="number"
          min={0}
          max={1}
          step={0.1}
          disabled={hasThread}
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
          className="w-20 text-right rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        />
      </div>

      <div className="flex items-center justify-between opacity-60">
        <label className="text-xs text-muted-foreground">
          Recency weight
          <span className="block text-[10px]">auto (1 − similarity)</span>
        </label>
        <span className="text-xs font-mono text-muted-foreground w-20 text-right pr-1">
          {settings.recencyWeight.toFixed(1)}
        </span>
      </div>

      {hasThread && (
        <p className="text-[10px] text-muted-foreground bg-muted/50 rounded px-2 py-1">
          Thread active, settings frozen at creation.
        </p>
      )}
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

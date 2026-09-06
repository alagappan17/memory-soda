import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Info, Lock } from 'lucide-react';
import type {
  ProjectEpisodicSettings,
  ProjectSemanticSettings,
} from '@memory-soda/types';
import { getProjectSettings } from '../../lib/api';
import type { WMSettings } from './types';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

// Definition, range, default, and what raising/lowering it does — kept to a
// couple of sentences so it fits a tooltip.
function InfoTip({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label="About this setting"
            className="text-muted-foreground hover:text-foreground cursor-help"
          />
        }
      >
        <Info className="size-2.5" />
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-64">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

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
  info,
  frozen,
  off,
  children,
}: {
  label: string;
  hint?: string;
  /** Definition, range, default, and effect of raising/lowering — shown on hover. */
  info?: React.ReactNode;
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
          {info && <InfoTip>{info}</InfoTip>}
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

      <Row
        label="Auto-compact"
        frozen={hasThread}
        info="Summarizes older messages into one compact summary once the thread crosses the threshold below. Default: off. On: keeps prepare() fast on long threads; off: full history is sent every time until you compact manually."
      >
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
        info="Number of messages in a thread before auto-compact fires. Range: 2-500. Default: 10. Lower = summarizes sooner, losing detail earlier but keeping calls fast; higher = keeps more raw history but prepare() slows down."
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

      <Row
        label="Message limit"
        hint="per prepare call, editable anytime"
        info="Max messages returned per prepare() call. Range: 1-100. Default: 20. Lower = smaller, cheaper prompts; higher = more context but slower and costlier calls."
      >
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

      <Row
        label="Enabled"
        frozen={hasThread}
        info="Turns episode generation on/off for this thread. Default: on. Off: no episodes are generated, and semantic fact extraction (which reads episodes) never runs."
      >
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
        info="Seconds of silence after the last message before an episode is generated. Range: 1s+, blank disables the timer. Project default: 1800s (30 min). Lower = facts land sooner but more LLM extraction calls; higher = fewer calls but facts lag behind the conversation."
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

      <p className="text-[10px] text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded px-2 py-1">
        Playground only: this interval is set to 10s (real projects default to
        30 min) so episodes, and the facts extracted from them, show up almost
        instantly while you test.
      </p>

      <Row
        label="Max messages"
        hint="analyzed per episode"
        frozen={hasThread}
        off={off}
        info="Max messages analyzed per episode. Range: 1+. Default: 100. Lower = cheaper, faster extraction but may cut off long exchanges; higher = full coverage but slower per-episode calls."
      >
        {number('maxMessages', (raw) => Math.max(1, parseInt(raw, 10) || 100))}
      </Row>

      <Row
        label="Max retries"
        hint="on extraction failure"
        frozen={hasThread}
        off={off}
        info="Retries on extraction failure before giving up. Range: 0+. Default: 3. Higher = more resilient to transient LLM errors but slower to surface a real failure; 0 = fail fast, no retry."
      >
        {number('maxRetries', (raw) => Math.max(0, parseInt(raw, 10) || 0))}
      </Row>

      <Row
        label="Context episodes"
        hint="injected into recall"
        frozen={hasThread}
        off={off}
        info="Number of past episodes injected into recall() context. Range: 1+. Default: 3. Higher = more historical context but bigger prompts; lower = leaner but less continuity."
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
        info="Weight given to semantic similarity vs. recency when ranking episodes for recall. Range: 0-1. Default: 0.7. Higher = favors topically similar episodes; lower = favors recent ones. Recency weight is always 1 minus this."
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
        info="Weight given to recency when ranking episodes for recall. Not directly editable, always 1 minus similarity weight. Default: 0.3."
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
  info: string;
}[] = [
  {
    key: 'enabled',
    label: 'Enabled',
    hint: 'fact extraction on/off',
    info: 'Turns semantic fact extraction on/off for the project. Default: on. Off: episodes are still generated but no facts or entities are extracted from them.',
  },
  {
    key: 'retrievalMinConfidence',
    label: 'Min confidence',
    hint: 'retrieval floor, all facts stored',
    info: 'Confidence floor for facts returned by recall(); every extracted fact is stored regardless of confidence. Range: 0-1. Default: 0.5. Higher = fewer, more certain facts surfaced; lower = more facts but noisier.',
  },
  {
    key: 'factsInContext',
    label: 'Facts in context',
    hint: 'recall limit',
    info: 'Max facts injected into recall() context. Default: 8. Higher = richer context but bigger prompts; lower = leaner but may miss relevant facts.',
  },
  {
    key: 'entityResolutionThreshold',
    label: 'Entity resolution',
    hint: 'merge similarity',
    info: 'Cosine similarity above which two entity mentions are merged into one. Range: 0-1. Default: 0.88. Higher = stricter, more duplicate entities slip through; lower = looser, risks merging distinct entities.',
  },
  {
    key: 'factDedupThreshold',
    label: 'Fact dedup',
    hint: 'duplicate cutoff',
    info: 'Similarity above which a new fact is treated as a duplicate of an existing one. Range: 0-1. Default: 0.95. Higher = more near-duplicate facts kept separately; lower = more aggressive deduping, risking lost nuance.',
  },
  {
    key: 'contradictionBandMin',
    label: 'Contradiction band',
    hint: 'invalidation floor',
    info: 'Lower bound of similarity where a new fact is checked against existing ones for contradiction. Range: 0-1. Default: 0.8. Lower = checks a wider range of facts for conflicts, more invalidations; higher = narrower, fewer checks.',
  },
  {
    key: 'anchorVectorMin',
    label: 'Anchor vector min',
    hint: 'entity retrieval floor',
    info: 'Minimum similarity for an entity to anchor retrieval. Range: 0-1. Default: 0.75. Lower = more entities considered, more recall but more noise; higher = fewer, more precise anchors.',
  },
  {
    key: 'anchorVectorTopK',
    label: 'Anchor top-K',
    hint: 'entities per query',
    info: 'Max entities anchored per recall query. Default: 3. Higher = broader entity coverage but bigger prompts; lower = narrower and cheaper.',
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
          {SEMANTIC_ROWS.map(({ key, label, hint, info }) => (
            <div key={key} className="flex items-center justify-between">
              <label className="text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  {label}
                  <InfoTip>{info}</InfoTip>
                </span>
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

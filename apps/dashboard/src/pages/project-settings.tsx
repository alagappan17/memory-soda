import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { getProjectSettings, updateProjectSettings } from '@/lib/api';
import type { ProjectSettings } from '@memory-soda/types';
import { useProject } from '@/providers/project-provider';
import { Check, AlertCircle, ChevronDown } from 'lucide-react';
import { createPortal } from 'react-dom';

/**
 * Project settings.
 *
 * Fifteen numbers govern this project, but only a handful are decisions an
 * operator makes; the rest are similarity thresholds you tune by measuring
 * retrieval quality, not by guessing in a form. The everyday ones are on the
 * page, the tuning ones are behind a disclosure that says as much.
 */

type Layer = 'episodic' | 'semantic';

interface FieldCommon {
  label: string;
  help: string;
  min: number;
  max: number;
  step: number;
  integer?: boolean;
}

/**
 * A field names its layer and a key that exists on that layer, so a typo or a
 * renamed setting is a compile error rather than an input wired to nothing.
 */
type NumberField =
  | (FieldCommon & {
      layer: 'episodic';
      key:
        | 'maxMessages'
        | 'maxRetries'
        | 'contextEpisodes'
        | 'similarityWeight';
    })
  | (FieldCommon & {
      layer: 'semantic';
      key:
        | 'retrievalMinConfidence'
        | 'factsInContext'
        | 'entityResolutionThreshold'
        | 'factDedupThreshold'
        | 'contradictionBandMin'
        | 'anchorVectorMin'
        | 'anchorVectorTopK';
    });

function readField(settings: ProjectSettings, f: NumberField): number {
  return f.layer === 'episodic'
    ? settings.episodic[f.key]
    : settings.semantic[f.key];
}

/**
 * Episode ranking splits one budget between relevance and recency, so setting
 * either weight sets both — two independent inputs that must sum to one is a
 * trap, not a control.
 */
function writeField(
  settings: ProjectSettings,
  f: NumberField,
  value: number,
): ProjectSettings {
  if (f.layer === 'episodic') {
    const episodic = { ...settings.episodic, [f.key]: value };
    if (f.key === 'similarityWeight') {
      episodic.recencyWeight = Number((1 - value).toFixed(2));
    }
    return { ...settings, episodic };
  }
  return { ...settings, semantic: { ...settings.semantic, [f.key]: value } };
}

/** The settings worth putting in front of someone. */
const PRIMARY: NumberField[] = [
  {
    layer: 'semantic',
    key: 'factsInContext',
    label: 'Facts per recall',
    help: 'How many facts a recall() call puts in the context block. More context costs more tokens on every turn.',
    min: 1,
    max: 100,
    step: 1,
    integer: true,
  },
  {
    layer: 'semantic',
    key: 'retrievalMinConfidence',
    label: 'Confidence floor',
    help: 'Facts the model rated below this are stored but never recalled. Raise it if the assistant repeats things the user never quite said.',
    min: 0,
    max: 1,
    step: 0.05,
  },
  {
    layer: 'episodic',
    key: 'contextEpisodes',
    label: 'Episodes per recall',
    help: 'Past conversation summaries included when a call opts into episodes.',
    min: 1,
    max: 20,
    step: 1,
    integer: true,
  },
  {
    layer: 'episodic',
    key: 'maxRetries',
    label: 'Extraction retries',
    help: 'How many times a failed extraction is retried before it is left alone.',
    min: 0,
    max: 10,
    step: 1,
    integer: true,
  },
];

/** Tuning knobs. Correct values come from measuring, not from intuition. */
const ADVANCED: NumberField[] = [
  {
    layer: 'semantic',
    key: 'entityResolutionThreshold',
    label: 'Entity merge similarity',
    help: 'Above this, two names of the same type become one entity. Too low and distinct things merge; too high and aliases split.',
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    layer: 'semantic',
    key: 'factDedupThreshold',
    label: 'Fact duplicate similarity',
    help: 'Above this, a new fact is treated as a restatement and dropped.',
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    layer: 'semantic',
    key: 'contradictionBandMin',
    label: 'Contradiction band floor',
    help: 'Facts between this and the duplicate threshold are sent to the consistency judge. This is what catches "works at" versus "is employed by".',
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    layer: 'semantic',
    key: 'anchorVectorMin',
    label: 'Entity anchor similarity',
    help: 'How close a query must be to an entity for that entity to pull its facts into retrieval.',
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    layer: 'semantic',
    key: 'anchorVectorTopK',
    label: 'Entity anchors per query',
    help: 'How many vector-matched entities may anchor one retrieval.',
    min: 1,
    max: 10,
    step: 1,
    integer: true,
  },
  {
    layer: 'episodic',
    key: 'maxMessages',
    label: 'Transcript cap',
    help: 'Messages an extraction prompt may contain before the middle is truncated.',
    min: 10,
    max: 1000,
    step: 10,
    integer: true,
  },
  {
    layer: 'episodic',
    key: 'similarityWeight',
    label: 'Episode similarity weight',
    help: 'How much episode ranking favours relevance over recency. The recency weight is the remainder.',
    min: 0,
    max: 1,
    step: 0.1,
  },
];

export default function ProjectSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const { projects } = useProject();
  const project = projects.find((p) => p.id === id);

  const [saved, setSaved] = useState<ProjectSettings | null>(null);
  const [settings, setSettings] = useState<ProjectSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [toast, setToast] = useState<{
    visible: boolean;
    message: string;
    type: 'success' | 'error';
  }>({ visible: false, message: '', type: 'success' });

  function showToast(message: string, type: 'success' | 'error') {
    setToast({ visible: true, message, type });
    setTimeout(() => setToast((prev) => ({ ...prev, visible: false })), 3000);
  }

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getProjectSettings(id)
      .then((res) => {
        setSaved(res.settings);
        setSettings(res.settings);
      })
      .catch(() => showToast('Failed to load settings', 'error'))
      .finally(() => setLoading(false));
  }, [id]);

  const isDirty =
    settings && saved
      ? JSON.stringify(settings) !== JSON.stringify(saved)
      : false;

  function setEnabled(layer: Layer, value: boolean) {
    setSettings((prev) =>
      prev ? { ...prev, [layer]: { ...prev[layer], enabled: value } } : prev,
    );
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !settings) return;
    setSaving(true);
    try {
      const res = await updateProjectSettings(id, settings);
      setSaved(res.settings);
      setSettings(res.settings);
      showToast('Settings saved', 'success');
    } catch {
      showToast('Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (!project) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-10 text-center text-muted-foreground">
        Project not found
      </div>
    );
  }

  if (loading || !settings) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-10 text-sm text-muted-foreground">
        Loading settings…
      </div>
    );
  }

  const enabled = (f: NumberField) => settings[f.layer].enabled;

  const field = (f: NumberField) => (
    <div
      key={`${f.layer}.${f.key}`}
      className={`grid grid-cols-[1fr_7rem] gap-4 items-start py-4 border-b border-border last:border-0 ${
        enabled(f) ? '' : 'opacity-40 pointer-events-none'
      }`}
    >
      <div className="min-w-0">
        <label
          htmlFor={`${f.layer}-${f.key}`}
          className="text-sm font-medium block"
        >
          {f.label}
        </label>
        <p className="text-xs text-muted-foreground mt-0.5">{f.help}</p>
      </div>
      <input
        id={`${f.layer}-${f.key}`}
        type="number"
        min={f.min}
        max={f.max}
        step={f.step}
        value={readField(settings, f)}
        onChange={(e) => {
          const parsed = f.integer
            ? parseInt(e.target.value, 10)
            : parseFloat(e.target.value);
          if (!Number.isNaN(parsed)) {
            setSettings((prev) => (prev ? writeField(prev, f, parsed) : prev));
          }
        }}
        className="h-9 rounded-lg border border-input bg-background px-3 text-sm tabular-nums"
      />
    </div>
  );

  const layerToggle = (layer: Layer, label: string, help: string) => (
    <label className="flex items-start gap-3 py-4 border-b border-border cursor-pointer">
      <input
        type="checkbox"
        checked={settings[layer].enabled}
        onChange={(e) => setEnabled(layer, e.target.checked)}
        className="mt-0.5 size-4"
      />
      <span className="min-w-0">
        <span className="text-sm font-medium block">{label}</span>
        <span className="text-xs text-muted-foreground">{help}</span>
      </span>
    </label>
  );

  return (
    <form onSubmit={handleSave} className="max-w-3xl mx-auto px-6 py-10 w-full">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold">Project settings</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-prose">
          Defaults for <strong>{project.name}</strong>, applied to threads
          created after you save. A single thread can override the episodic ones
          by passing{' '}
          <code className="font-mono bg-muted px-1 py-0.5 rounded text-xs">
            settings.episodic
          </code>{' '}
          to{' '}
          <code className="font-mono bg-muted px-1 py-0.5 rounded text-xs">
            threads.create()
          </code>
          .
        </p>
      </header>

      <section className="mb-8">
        <h2 className="text-sm font-semibold mb-1">Memory layers</h2>
        {layerToggle(
          'episodic',
          'Episodic memory',
          'Summarise each stretch of conversation. Turning this off also stops semantic extraction, which reads from episodes.',
        )}
        {layerToggle(
          'semantic',
          'Semantic memory',
          'Extract durable facts from episodes and serve them through recall().',
        )}
      </section>

      <section className="mb-8">
        <h2 className="text-sm font-semibold mb-1">Retrieval</h2>
        {PRIMARY.map(field)}
      </section>

      <section className="mb-8">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex items-center gap-1.5 text-sm font-semibold"
          aria-expanded={showAdvanced}
        >
          <ChevronDown
            className={`size-4 transition-transform ${showAdvanced ? '' : '-rotate-90'}`}
          />
          Tuning
        </button>
        <p className="text-xs text-muted-foreground mt-1 max-w-prose">
          Similarity thresholds. The defaults were chosen by measuring retrieval
          quality — change them the same way, not by intuition, and check the
          Playground&apos;s recall inspector afterwards.
        </p>
        {showAdvanced && <div className="mt-2">{ADVANCED.map(field)}</div>}
      </section>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!isDirty || saving}
          className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {isDirty && (
          <span className="text-xs text-muted-foreground">Unsaved changes</span>
        )}
      </div>

      {toast.visible &&
        createPortal(
          <div className="fixed bottom-6 right-6 flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm">
            {toast.type === 'success' ? (
              <Check className="size-4 text-foreground" />
            ) : (
              <AlertCircle className="size-4 text-destructive" />
            )}
            {toast.message}
          </div>,
          document.body,
        )}
    </form>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { getProjectSettings, updateProjectSettings } from '@/lib/api';
import type { ProjectSettings } from '@memory-soda/types';
import { useProject } from '@/providers/project-provider';
import { Check, AlertCircle, ChevronRight } from 'lucide-react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

function settingsEqual(a: ProjectSettings, b: ProjectSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const inputClass =
  'w-full text-sm rounded-md border border-input bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring';

function Advanced({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pt-4 mt-4 border-t border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight
          className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
        />
        Advanced
      </button>
      {open && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">{children}</div>
      )}
    </div>
  );
}

type Tab = 'working' | 'episodic' | 'semantic';

const TABS: { id: Tab; label: string }[] = [
  { id: 'working', label: 'Working Memory' },
  { id: 'episodic', label: 'Episodic Memory' },
  { id: 'semantic', label: 'Semantic Memory' },
];

export default function ProjectSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const { projects } = useProject();
  const project = projects.find((p) => p.id === id);

  const [activeTab, setActiveTab] = useState<Tab>('working');
  const [savedSettings, setSavedSettings] = useState<ProjectSettings | null>(null);
  const [settings, setSettings] = useState<ProjectSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
        setSavedSettings(res.settings);
        setSettings(res.settings);
      })
      .catch(() => showToast('Failed to load settings', 'error'))
      .finally(() => setLoading(false));
  }, [id]);

  const isDirty = settings && savedSettings ? !settingsEqual(settings, savedSettings) : false;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !settings) return;
    setSaving(true);
    try {
      const res = await updateProjectSettings(id, {
        episodic: settings.episodic,
        semantic: settings.semantic,
        working: settings.working,
      });
      setSavedSettings(res.settings);
      setSettings(res.settings);
      showToast('Settings saved successfully', 'success');
    } catch {
      showToast('Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  }

  const handleChange = useCallback(
    (field: keyof ProjectSettings['episodic'], value: unknown) => {
      setSettings((prev) =>
        prev ? { ...prev, episodic: { ...prev.episodic, [field]: value } } : prev,
      );
    },
    [],
  );

  const handleSemanticChange = useCallback(
    (field: keyof ProjectSettings['semantic'], value: unknown) => {
      setSettings((prev) =>
        prev ? { ...prev, semantic: { ...prev.semantic, [field]: value } } : prev,
      );
    },
    [],
  );

  const handleWorkingChange = useCallback(
    (field: keyof ProjectSettings['working'], value: unknown) => {
      setSettings((prev) =>
        prev ? { ...prev, working: { ...prev.working, [field]: value } } : prev,
      );
    },
    [],
  );

  const episodicEnabled = settings?.episodic.enabled ?? false;
  const semanticEnabled = settings?.semantic.enabled ?? false;
  const episodicFields = (base: string) =>
    `${base}${!episodicEnabled ? ' opacity-40 pointer-events-none' : ''}`;
  const semanticFields = (base: string) =>
    `${base}${!semanticEnabled ? ' opacity-40 pointer-events-none' : ''}`;

  if (!project) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="text-center py-10 text-muted-foreground">Project not found</div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-10 w-full">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">Project Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Default settings for <strong>{project.name}</strong>. Applied to all new threads
          automatically — override per-thread via{' '}
          <code className="font-mono bg-muted px-1 py-0.5 rounded text-xs">threads.create()</code>{' '}
          in the SDK.
        </p>
      </div>

      {loading ? (
        <div className="py-10 text-center text-muted-foreground text-sm">Loading settings…</div>
      ) : settings ? (
        <form onSubmit={handleSave}>
          {/* Tab bar */}
          <div className="flex gap-1 p-1 bg-muted rounded-lg mb-8">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-150',
                  activeTab === tab.id
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* ── Working Memory ─────────────────────────────────────── */}
          {activeTab === 'working' && (
            <div className="space-y-6">
              <p className="text-xs text-muted-foreground">
                Controls the live message window and automatic compaction for threads in this
                project.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Auto-Compact Threshold</label>
                  <p className="text-xs text-muted-foreground">
                    Summarize older messages once this many un-compacted messages accumulate. Leave
                    empty to disable.
                  </p>
                  <input
                    type="number"
                    min={2}
                    placeholder="off"
                    className={inputClass}
                    value={settings.working.autoCompactThreshold ?? ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      handleWorkingChange(
                        'autoCompactThreshold',
                        val === '' ? null : Math.max(2, parseInt(val) || 2),
                      );
                    }}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Default Message Limit</label>
                  <p className="text-xs text-muted-foreground">
                    Recent messages included on each{' '}
                    <code className="font-mono bg-muted px-1 py-0.5 rounded text-xs">
                      prepare()
                    </code>{' '}
                    when the caller doesn't specify one.
                  </p>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    className={inputClass}
                    value={settings.working.messageLimit}
                    onChange={(e) =>
                      handleWorkingChange(
                        'messageLimit',
                        Math.min(100, Math.max(1, parseInt(e.target.value) || 20)),
                      )
                    }
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── Episodic Memory ────────────────────────────────────── */}
          {activeTab === 'episodic' && (
            <div className="space-y-6">
              <p className="text-xs text-muted-foreground">
                Controls how memories are extracted and retrieved for threads in this project.
              </p>

              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium">Enable Episodic Memory</label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Extract and embed memories when an episode is generated for a thread.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={episodicEnabled}
                    onChange={(e) => handleChange('enabled', e.target.checked)}
                  />
                  <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
                </label>
              </div>

              <div
                className={episodicFields(
                  'space-y-6 pt-4 border-t border-border transition-opacity duration-200',
                )}
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Max Messages</label>
                    <p className="text-xs text-muted-foreground">
                      Limit the number of messages analyzed per episode.
                    </p>
                    <input
                      type="number"
                      min={10}
                      max={1000}
                      className={inputClass}
                      value={settings.episodic.maxMessages}
                      onChange={(e) =>
                        handleChange('maxMessages', parseInt(e.target.value) || 100)
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Context Episodes</label>
                    <p className="text-xs text-muted-foreground">
                      Number of relevant episodes to retrieve during{' '}
                      <code className="font-mono bg-muted px-1 py-0.5 rounded text-xs">
                        prepare()
                      </code>
                      .
                    </p>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      className={inputClass}
                      value={settings.episodic.episodesInContext}
                      onChange={(e) =>
                        handleChange('episodesInContext', parseInt(e.target.value) || 3)
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Auto-Episode Interval (min)</label>
                    <p className="text-xs text-muted-foreground">
                      Minutes of inactivity before an episode is auto-generated. Leave empty to
                      disable.
                    </p>
                    <input
                      type="number"
                      min={1}
                      placeholder="off"
                      className={inputClass}
                      value={
                        settings.episodic.autoEpisodeIntervalMs !== null
                          ? Math.round(
                              (settings.episodic.autoEpisodeIntervalMs ?? 1_800_000) / 60_000,
                            )
                          : ''
                      }
                      onChange={(e) => {
                        const val = e.target.value;
                        handleChange(
                          'autoEpisodeIntervalMs',
                          val === '' ? null : Math.max(1, parseInt(val) || 1) * 60_000,
                        );
                      }}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Recency Bias</label>
                    <p className="text-xs text-muted-foreground">
                      How much retrieval favors recent episodes vs. semantic similarity (0.0 – 1.0).
                      Similarity weight is{' '}
                      <code className="font-mono bg-muted px-1 py-0.5 rounded text-xs">
                        1 − recency
                      </code>
                      .
                    </p>
                    <input
                      type="number"
                      step="0.05"
                      min={0}
                      max={1}
                      className={inputClass}
                      value={settings.episodic.recencyWeight}
                      onChange={(e) => {
                        const val = Math.min(1, Math.max(0, parseFloat(e.target.value) || 0));
                        handleChange('recencyWeight', val);
                      }}
                    />
                  </div>
                </div>

                <Advanced>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Max Retries</label>
                    <p className="text-xs text-muted-foreground">
                      Number of times to retry failed episode extraction.
                    </p>
                    <input
                      type="number"
                      min={0}
                      max={10}
                      className={inputClass}
                      value={settings.episodic.maxRetries}
                      onChange={(e) =>
                        handleChange(
                          'maxRetries',
                          ((v) => (isNaN(v) ? 3 : v))(parseInt(e.target.value)),
                        )
                      }
                    />
                  </div>
                </Advanced>
              </div>
            </div>
          )}

          {/* ── Semantic Memory ────────────────────────────────────── */}
          {activeTab === 'semantic' && (
            <div className="space-y-6">
              <p className="text-xs text-muted-foreground">
                Controls knowledge-graph extraction from episodes and fact injection into LLM
                context.
              </p>

              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium">Enable Semantic Memory</label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Extract entities and facts from completed episodes into the knowledge graph.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={semanticEnabled}
                    onChange={(e) => handleSemanticChange('enabled', e.target.checked)}
                  />
                  <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
                </label>
              </div>

              <div
                className={semanticFields(
                  'space-y-6 pt-4 border-t border-border transition-opacity duration-200',
                )}
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Facts per Prepare</label>
                    <p className="text-xs text-muted-foreground">
                      Number of semantic facts injected into LLM context on each{' '}
                      <code className="font-mono bg-muted px-1 py-0.5 rounded text-xs">
                        prepare()
                      </code>{' '}
                      call.
                    </p>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      className={inputClass}
                      value={settings.semantic.factsInContext}
                      onChange={(e) =>
                        handleSemanticChange('factsInContext', parseInt(e.target.value) || 5)
                      }
                    />
                  </div>
                </div>

                <Advanced>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Min User Facts to Process</label>
                    <p className="text-xs text-muted-foreground">
                      Skip graph extraction if an episode has fewer than this many user facts.
                    </p>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      className={inputClass}
                      value={settings.semantic.minUserFacts}
                      onChange={(e) =>
                        handleSemanticChange('minUserFacts', parseInt(e.target.value) || 2)
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Min Confidence</label>
                    <p className="text-xs text-muted-foreground">
                      Discard extracted facts below this confidence (0.0 – 1.0). Higher = cleaner
                      but sparser graph.
                    </p>
                    <input
                      type="number"
                      step={0.05}
                      min={0}
                      max={1}
                      className={inputClass}
                      value={settings.semantic.minConfidence}
                      onChange={(e) =>
                        handleSemanticChange(
                          'minConfidence',
                          Math.min(1, Math.max(0, parseFloat(e.target.value) || 0)),
                        )
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Entity Merge Threshold</label>
                    <p className="text-xs text-muted-foreground">
                      Cosine similarity (0.5 – 1.0) required to treat two entity names as the same.
                    </p>
                    <input
                      type="number"
                      step={0.01}
                      min={0.5}
                      max={1}
                      className={inputClass}
                      value={settings.semantic.entitySimilarityThreshold}
                      onChange={(e) =>
                        handleSemanticChange(
                          'entitySimilarityThreshold',
                          parseFloat(e.target.value) || 0.95,
                        )
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Max Retries</label>
                    <p className="text-xs text-muted-foreground">
                      Number of times to retry failed semantic processing jobs.
                    </p>
                    <input
                      type="number"
                      min={0}
                      max={10}
                      className={inputClass}
                      value={settings.semantic.maxRetries}
                      onChange={(e) =>
                        handleSemanticChange('maxRetries', parseInt(e.target.value) || 3)
                      }
                    />
                  </div>
                </Advanced>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 mt-10 pt-4 border-t border-border">
            {isDirty && (
              <span className="text-xs text-muted-foreground">Unsaved changes</span>
            )}
            <button
              type="submit"
              disabled={saving || !isDirty}
              className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              {saving ? 'Saving…' : 'Save Settings'}
            </button>
          </div>
        </form>
      ) : null}

      {toast.visible &&
        createPortal(
          <div className="fixed top-6 right-6 z-[9999] flex items-center gap-3.5 px-4 py-3 rounded-xl border border-border bg-card text-card-foreground shadow-lg animate-in fade-in-0 slide-in-from-top-5 duration-300 min-w-[300px] select-none font-sans">
            {toast.type === 'success' ? (
              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <Check className="h-3.5 w-3.5 stroke-[3]" />
              </div>
            ) : (
              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <AlertCircle className="h-3.5 w-3.5 stroke-[2.5]" />
              </div>
            )}
            <span className="text-sm font-medium text-foreground">{toast.message}</span>
          </div>,
          document.body,
        )}
    </div>
  );
}

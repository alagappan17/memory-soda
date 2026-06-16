import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { getProjectSettings, updateProjectSettings } from '@/lib/api';
import type { ProjectSettings } from '@memory-soda/types';
import { useProject } from '@/providers/project-provider';
import { Check, AlertCircle } from 'lucide-react';
import { createPortal } from 'react-dom';

function settingsEqual(a: ProjectSettings, b: ProjectSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export default function ProjectSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const { projects } = useProject();
  const project = projects.find((p) => p.id === id);

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
      const res = await updateProjectSettings(id, { episodic: settings.episodic });
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
        prev
          ? { ...prev, episodic: { ...prev.episodic, [field]: value } }
          : prev,
      );
    },
    [],
  );

  const episodicEnabled = settings?.episodic.enabled ?? false;
  const fieldClass = (base: string) =>
    `${base}${!episodicEnabled ? ' opacity-40 pointer-events-none' : ''}`;

  if (!project) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="text-center py-10 text-muted-foreground">
          Project not found
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-10 w-full">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">Project Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Default settings for <strong>{project.name}</strong>. These are applied
          to all new threads automatically. You can edit them here at any time —
          changes apply to threads created after saving. To override per thread,
          pass{' '}
          <code className="font-mono bg-muted px-1 py-0.5 rounded text-xs">
            config.episodic
          </code>{' '}
          when calling{' '}
          <code className="font-mono bg-muted px-1 py-0.5 rounded text-xs">
            threads.create()
          </code>{' '}
          in the SDK.
        </p>
      </div>

      {loading ? (
        <div className="py-10 text-center text-muted-foreground text-sm">
          Loading settings...
        </div>
      ) : settings ? (
        <form onSubmit={handleSave} className="space-y-8">
          <div>
            <h2 className="text-lg font-medium mb-1">Episodic Memory</h2>
            <p className="text-xs text-muted-foreground mb-6">
              Controls how memories are extracted and retrieved for threads in
              this project.
            </p>

            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium">
                    Enable Episodic Memory
                  </label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Extract and embed memories when{' '}
                    <code className="font-mono bg-muted px-1 py-0.5 rounded text-xs">
                      end()
                    </code>{' '}
                    is called on a thread.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={episodicEnabled}
                    onChange={(e) => handleChange('enabled', e.target.checked)}
                  />
                  <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                </label>
              </div>

              <div className={fieldClass('grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-border transition-opacity duration-200')}>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Max Messages</label>
                  <p className="text-xs text-muted-foreground">
                    Limit the number of messages analyzed per episode.
                  </p>
                  <input
                    type="number"
                    min={10}
                    max={1000}
                    className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring"
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
                    className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring"
                    value={settings.episodic.contextEpisodes}
                    onChange={(e) =>
                      handleChange('contextEpisodes', parseInt(e.target.value) || 3)
                    }
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Max Retries</label>
                  <p className="text-xs text-muted-foreground">
                    Number of times to retry failed episode extraction.
                  </p>
                  <input
                    type="number"
                    min={0}
                    max={10}
                    className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring"
                    value={settings.episodic.maxRetries}
                    onChange={(e) =>
                      handleChange('maxRetries', parseInt(e.target.value) || 3)
                    }
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Auto-Episode Interval (min)</label>
                  <p className="text-xs text-muted-foreground">
                    Minutes of inactivity before an episode is auto-generated. Leave empty to disable.
                  </p>
                  <input
                    type="number"
                    min={1}
                    placeholder="off"
                    className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring"
                    value={
                      settings.episodic.autoEpisodeIntervalMs !== null
                        ? Math.round((settings.episodic.autoEpisodeIntervalMs ?? 1_800_000) / 60_000)
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
                  <label className="text-sm font-medium">Similarity Weight</label>
                  <p className="text-xs text-muted-foreground">
                    Relevance weighting for semantic similarity (0.0 – 1.0).
                  </p>
                  <input
                    type="number"
                    step="0.1"
                    min={0}
                    max={1}
                    className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring"
                    value={settings.episodic.similarityWeight}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      handleChange('similarityWeight', val);
                      handleChange('recencyWeight', Number((1 - val).toFixed(1)));
                    }}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Recency Weight</label>
                  <p className="text-xs text-muted-foreground">
                    Relevance weighting for recency (0.0 – 1.0). Auto-computed.
                  </p>
                  <input
                    type="number"
                    step="0.1"
                    min={0}
                    max={1}
                    className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 outline-none opacity-40"
                    value={settings.episodic.recencyWeight}
                    disabled
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-border">
            <button
              type="submit"
              disabled={saving || !isDirty}
              className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              {saving ? 'Saving...' : 'Save Settings'}
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
            <span className="text-sm font-medium text-foreground">
              {toast.message}
            </span>
          </div>,
          document.body,
        )}
    </div>
  );
}

import { useState, useEffect } from 'react';
import type { ApiKey } from '@memory-soda/types';
import { useProject } from '@/providers/project-provider';
import api from '@/lib/api';

export default function ApiKeysPage() {
  const { selectedProject } = useProject();
  const [allKeys, setAllKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const keys = selectedProject
    ? allKeys.filter((k) => k.projectId === selectedProject.id)
    : allKeys;

  async function fetchKeys() {
    try {
      const res = await api.get('/dashboard/api-keys');
      setAllKeys(res.data.apiKeys);
    } catch {
      setError('Failed to load API keys');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchKeys(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const body: Record<string, string> = { name: newName.trim() };
      if (selectedProject) body['projectId'] = selectedProject.id;
      const res = await api.post('/dashboard/api-keys', body);
      setCreatedKey(res.data.key);
      setAllKeys((prev) => [...prev, res.data.apiKey]);
      setNewName('');
      setShowCreate(false);
    } catch {
      setError('Failed to create API key');
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!confirm('Revoke this API key? This cannot be undone.')) return;
    try {
      await api.delete(`/dashboard/api-keys/${id}`);
      setAllKeys((prev) => prev.map((k) => k.id === id ? { ...k, revokedAt: new Date().toISOString() } : k));
    } catch {
      setError('Failed to revoke API key');
    }
  }

  async function copyKey(key: string) {
    await navigator.clipboard.writeText(key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!selectedProject) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-20 text-center">
        <p className="text-muted-foreground text-sm">Select or create a project to manage API keys.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold">API Keys</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Keys for <span className="font-medium text-foreground">{selectedProject.name}</span>. Store them securely — they are shown only once.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="text-sm px-4 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
        >
          Create key
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-md bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}

      {/* Created key banner */}
      {createdKey && (
        <div className="mb-6 p-4 rounded-md border border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950">
          <p className="text-sm font-medium text-green-800 dark:text-green-300 mb-2">
            Key created — copy it now, it won&apos;t be shown again
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono bg-white dark:bg-black/20 rounded px-3 py-2 border border-green-200 dark:border-green-900 overflow-x-auto">
              {createdKey}
            </code>
            <button
              onClick={() => copyKey(createdKey)}
              className="shrink-0 text-xs px-3 py-2 rounded-md bg-green-700 text-white hover:bg-green-600 transition-colors"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <button
            onClick={() => setCreatedKey(null)}
            className="mt-2 text-xs text-green-700 dark:text-green-400 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="mb-6 p-4 rounded-md border border-border bg-card">
          <h2 className="text-sm font-medium mb-3">New API key</h2>
          <form onSubmit={handleCreate} className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Key name (e.g. playground-local)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="flex-1 text-sm rounded-md border border-input bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring"
              autoFocus
            />
            <button
              type="submit"
              disabled={creating || !newName.trim()}
              className="text-sm px-4 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {creating ? 'Creating...' : 'Create'}
            </button>
            <button
              type="button"
              onClick={() => { setShowCreate(false); setNewName(''); }}
              className="text-sm px-3 py-2 rounded-md border border-border hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          </form>
        </div>
      )}

      {/* Keys table */}
      <div className="rounded-md border border-border overflow-hidden">
        {loading ? (
          <div className="px-4 py-6 text-sm text-muted-foreground text-center">Loading...</div>
        ) : keys.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground text-center">
            No API keys yet. Create one to get started.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Key</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Created</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Last used</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{key.name}</td>
                  <td className="px-4 py-3">
                    <code className="text-xs font-mono text-muted-foreground">{key.keyPreview}</code>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(key.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {key.revokedAt ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/10 text-destructive">Revoked</span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">Active</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!key.revokedAt && (
                      <button
                        onClick={() => handleRevoke(key.id)}
                        className="text-xs text-destructive hover:underline"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

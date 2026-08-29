import { useState, useEffect } from 'react';
import type { ApiKey } from '@memory-soda/types';
import { useProject } from '@/providers/project-provider';
import api from '@/lib/api';
import { Check, Copy } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

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
  const [revokeId, setRevokeId] = useState<string | null>(null);

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

  useEffect(() => {
    fetchKeys();
  }, []);

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
    } catch {
      setError('Failed to create API key');
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    setRevokeId(null);
    try {
      await api.delete(`/dashboard/api-keys/${id}`);
      setAllKeys((prev) =>
        prev.map((k) =>
          k.id === id ? { ...k, revokedAt: new Date().toISOString() } : k,
        ),
      );
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
        <p className="text-muted-foreground text-sm">
          Select or create a project to manage API keys.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold">API Keys</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Keys for{' '}
            <span className="font-medium text-foreground">
              {selectedProject.name}
            </span>
            . Store them securely — they are shown only once.
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

      <Dialog
        open={showCreate}
        onOpenChange={(open) => {
          setShowCreate(open);
          if (!open) {
            setNewName('');
            setCreatedKey(null);
          }
        }}
      >
        <DialogContent>
          {createdKey ? (
            <>
              <DialogHeader>
                <DialogTitle>Key created</DialogTitle>
                <DialogDescription>
                  Copy it now — it won&apos;t be shown again after you close
                  this.
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 text-xs font-mono bg-muted rounded-md px-3 py-2 border border-border break-all select-all">
                  {createdKey}
                </code>
                <button
                  onClick={() => copyKey(createdKey)}
                  aria-label="Copy key"
                  className="shrink-0 p-2 rounded-md bg-primary text-primary-foreground hover:opacity-90"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
              <DialogFooter>
                <button
                  onClick={() => setShowCreate(false)}
                  className="text-sm px-4 py-2 rounded-md border border-border hover:bg-muted"
                >
                  Done
                </button>
              </DialogFooter>
            </>
          ) : (
            <form onSubmit={handleCreate} className="space-y-4">
              <DialogHeader>
                <DialogTitle>New API key</DialogTitle>
              </DialogHeader>
              <input
                type="text"
                placeholder="Key name (e.g. playground-local)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring"
                autoFocus
              />
              <DialogFooter>
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="text-sm px-3 py-2 rounded-md border border-border hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || !newName.trim()}
                  className="text-sm px-4 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {creating ? 'Creating...' : 'Create'}
                </button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!revokeId} onOpenChange={(o) => !o && setRevokeId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke API key?</DialogTitle>
            <DialogDescription>
              Requests using this key will stop working. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              onClick={() => setRevokeId(null)}
              className="text-sm px-3 py-2 rounded-md border border-border hover:bg-muted"
            >
              Cancel
            </button>
            <button
              onClick={() => revokeId && handleRevoke(revokeId)}
              className="text-sm px-4 py-2 rounded-md bg-destructive text-destructive-foreground hover:opacity-90"
            >
              Revoke
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Keys table */}
      <div className="rounded-md border border-border overflow-hidden">
        {loading ? (
          <div className="px-4 py-6 text-sm text-muted-foreground text-center">
            Loading...
          </div>
        ) : keys.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground text-center">
            No API keys yet. Create one to get started.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  Name
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  Key
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  Created
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  Last used
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  Status
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr
                  key={key.id}
                  className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-3 font-medium">{key.name}</td>
                  <td className="px-4 py-3">
                    <code className="text-xs font-mono text-muted-foreground">
                      {key.keyPreview}
                    </code>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(key.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {key.lastUsedAt
                      ? new Date(key.lastUsedAt).toLocaleDateString()
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {key.revokedAt ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/10 text-destructive">
                        Revoked
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full border border-border text-foreground">
                        Active
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!key.revokedAt && (
                      <button
                        onClick={() => setRevokeId(key.id)}
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

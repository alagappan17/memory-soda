import { useState, useCallback, useEffect } from 'react';
import { MemorySodaClient } from '@memory-soda/sdk';
import type { SemanticFact, SemanticEntity } from '@memory-soda/sdk';

const API_URL = import.meta.env['VITE_API_URL'] ?? 'http://localhost:3004';

function clientFor(apiKey: string): MemorySodaClient {
  return new MemorySodaClient({ baseUrl: API_URL, apiKey });
}

function factSentence(f: SemanticFact): string {
  return `${f.subject} ${f.predicate} ${f.object}`;
}

function formatRange(f: SemanticFact): string {
  const from = f.validAt.slice(0, 10);
  const to = f.invalidAt ? f.invalidAt.slice(0, 10) : 'present';
  return `${from} – ${to}`;
}

export default function MemoryPage() {
  const [apiKey, setApiKey] = useState(
    () => localStorage.getItem('ms_playground_key') ?? '',
  );
  const [userId, setUserId] = useState(
    () => localStorage.getItem('ms_playground_user') ?? '',
  );
  const [facts, setFacts] = useState<SemanticFact[]>([]);
  const [entities, setEntities] = useState<SemanticEntity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showInvalidated, setShowInvalidated] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!apiKey.trim() || !userId.trim()) {
      setError('API key and user ID are required.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const client = clientFor(apiKey.trim());
      const [factsRes, entitiesRes] = await Promise.all([
        client.semantic.listFacts(userId.trim(), {
          includeInvalidated: showInvalidated,
          limit: 100,
        }),
        client.semantic.listEntities(userId.trim()),
      ]);
      setFacts(factsRes.facts);
      setEntities(entitiesRes);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load memory');
    } finally {
      setLoading(false);
    }
  }, [apiKey, userId, showInvalidated]);

  // Refetch when the invalidated toggle changes (after first load).
  useEffect(() => {
    if (loaded) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showInvalidated]);

  async function remove(factId: string) {
    try {
      await clientFor(apiKey.trim()).semantic.deleteFact(userId.trim(), factId);
      setFacts((prev) =>
        prev.map((f) =>
          f.factId === factId
            ? { ...f, invalidAt: new Date().toISOString() }
            : f,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete fact');
    }
  }

  // Group facts by anchor entity (contextEntityName / subject).
  const groups = new Map<string, SemanticFact[]>();
  for (const f of facts) {
    const key = f.contextEntityName ?? f.subject;
    const arr = groups.get(key) ?? [];
    arr.push(f);
    groups.set(key, arr);
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 max-w-4xl mx-auto w-full">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Memory</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Durable facts learned about a user, rendered as sentences. Facts evolve
          over time — superseded facts are marked invalidated.
        </p>
      </div>

      {/* Auth */}
      <div className="flex flex-wrap items-end gap-3 mb-6">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">API Key</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="ms_..."
            className="w-64 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">User ID</span>
          <input
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="user-123"
            className="w-48 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
          />
        </label>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Load'}
        </button>
        <label className="flex items-center gap-1.5 text-xs ml-auto cursor-pointer">
          <input
            type="checkbox"
            checked={showInvalidated}
            onChange={(e) => setShowInvalidated(e.target.checked)}
          />
          <span>Show invalidated</span>
        </label>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {loaded && facts.length === 0 && !loading && (
        <p className="text-sm text-muted-foreground">
          No facts yet. Facts are extracted automatically after conversations.
        </p>
      )}

      {/* Entities */}
      {entities.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold mb-2">Entities</h2>
          <div className="flex flex-wrap gap-2">
            {entities.map((e) => (
              <span
                key={e.entityId}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs"
                title={JSON.stringify(e.attributes)}
              >
                <span className="font-medium">{e.name}</span>
                <span className="text-muted-foreground">{e.type}</span>
                <span className="text-muted-foreground">· {e.factCount}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Facts grouped by anchor */}
      {[...groups.entries()].map(([anchor, items]) => (
        <div key={anchor} className="mb-6">
          <h2 className="text-sm font-semibold mb-2 capitalize">{anchor}</h2>
          <ul className="space-y-1.5">
            {items.map((f) => {
              const invalidated = f.invalidAt !== null;
              return (
                <li
                  key={f.factId}
                  className={`group flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm ${
                    invalidated ? 'opacity-50' : ''
                  }`}
                >
                  <span
                    className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                      invalidated ? 'bg-muted-foreground' : 'bg-green-500'
                    }`}
                  />
                  <span className={invalidated ? 'line-through' : ''}>
                    {factSentence(f)}
                  </span>
                  <span className="text-[10px] text-muted-foreground ml-auto whitespace-nowrap">
                    {invalidated ? 'invalidated' : 'valid'} · {formatRange(f)}
                  </span>
                  {!invalidated && (
                    <button
                      onClick={() => void remove(f.factId)}
                      className="text-[10px] text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      delete
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

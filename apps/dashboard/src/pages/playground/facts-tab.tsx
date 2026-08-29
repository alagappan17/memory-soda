import { useCallback, useEffect, useRef, useState } from 'react';
import type { SemanticEntity, SemanticFact } from '@memory-soda/types';
import { call, quiet, describeError } from './api';
import type { AddOp } from './types';
import { applyFactDeletion } from '../../lib/fact-status';
import { EntityChip } from '../../components/entity-chip';
import { FactRow } from './fact-row';

/**
 * Live view of the semantic layer for the current dataset: facts with
 * bi-temporal status + provenance, entity chips with drill-down, soft-delete.
 */
export function FactsTab({
  apiKey,
  dataset,
  active,
  addOp,
  threshold,
}: {
  apiKey: string;
  dataset: string;
  active: boolean;
  addOp: AddOp;
  threshold: number | null;
}) {
  const [facts, setFacts] = useState<SemanticFact[]>([]);
  const [entities, setEntities] = useState<SemanticEntity[]>([]);
  const [q, setQ] = useState('');
  const [includeInvalidated, setIncludeInvalidated] = useState(false);
  const [asOf, setAsOf] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entityView, setEntityView] = useState<{
    name: string;
    facts: SemanticFact[];
  } | null>(null);
  const loadedOnce = useRef(false);

  const ready = !!apiKey.trim() && !!dataset.trim();
  const scope = dataset.trim();

  const loadFacts = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    setError(null);
    try {
      const factsRes = await quiet(apiKey, (memory) =>
        memory.listFacts(scope, {
          limit: 100,
          ...(q.trim() ? { q: q.trim() } : {}),
          ...(includeInvalidated ? { includeInvalidated: true } : {}),
          ...(asOf ? { asOf: new Date(asOf) } : {}),
        }),
      );
      setFacts(factsRes.facts);
      loadedOnce.current = true;
    } catch (err) {
      setError(describeError(err, 'Failed to load facts').message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, scope, q, includeInvalidated, asOf, ready]);

  // Entities don't depend on the fact filters — fetch once per scope
  // (and on explicit refresh), not on every debounced keystroke.
  const loadEntities = useCallback(async () => {
    if (!ready) return;
    try {
      setEntities(await quiet(apiKey, (memory) => memory.listEntities(scope)));
    } catch (err) {
      setError(describeError(err, 'Failed to load entities').message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, scope, ready]);

  const load = useCallback(async () => {
    await Promise.all([loadFacts(), loadEntities()]);
  }, [loadFacts, loadEntities]);

  // Reset when the memory scope changes.
  useEffect(() => {
    setFacts([]);
    setEntities([]);
    setEntityView(null);
    setError(null);
    loadedOnce.current = false;
  }, [apiKey, dataset]);

  // Load on first open.
  useEffect(() => {
    if (active && !loadedOnce.current) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Debounced facts reload when filters change (only after the first load).
  useEffect(() => {
    if (!loadedOnce.current) return;
    const t = setTimeout(() => void loadFacts(), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, includeInvalidated, asOf]);

  async function removeFact(factId: string) {
    try {
      const { trace } = await call(apiKey, (memory) =>
        memory.deleteFact(scope, factId),
      );
      addOp('fact_deleted', { factId }, trace);
      setFacts((prev) => applyFactDeletion(prev, factId, includeInvalidated));
      setEntityView((v) =>
        v ? { ...v, facts: v.facts.filter((f) => f.factId !== factId) } : v,
      );
    } catch (err) {
      const { message, trace } = describeError(err, 'Failed to delete fact');
      setError(message);
      addOp('error', { message }, trace);
    }
  }

  async function openEntity(name: string) {
    try {
      const { facts } = await quiet(apiKey, (memory) =>
        memory.listFacts(scope, { entity: name }),
      );
      setEntityView({ name, facts });
    } catch (err) {
      setError(describeError(err, 'Failed to load entity facts').message);
    }
  }

  return (
    <div className={active ? 'flex-1 overflow-y-auto min-h-0' : 'hidden'}>
      {/* Controls */}
      <div className="p-2 border-b border-border space-y-2 bg-card">
        <div className="flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Keyword search facts…"
            className="flex-1 min-w-0 rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            onClick={() => void load()}
            disabled={loading || !ready}
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors shrink-0"
            title="Refresh facts + entities"
          >
            ↻
          </button>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={includeInvalidated}
              onChange={(e) => setIncludeInvalidated(e.target.checked)}
              disabled={!!asOf}
            />
            include invalidated
          </label>
          <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground ml-auto">
            asOf
            <input
              type="datetime-local"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              className="rounded border border-input bg-background px-1.5 py-0.5 text-[10px] outline-none focus:ring-1 focus:ring-ring"
              title="Point-in-time: facts that were true at this instant (overrides include invalidated)"
            />
            {asOf && (
              <button
                onClick={() => setAsOf('')}
                className="hover:text-foreground"
              >
                ✕
              </button>
            )}
          </label>
        </div>
      </div>

      {error && (
        <div className="mx-2 mt-2 px-3 py-2 rounded-md bg-destructive/10 text-destructive text-xs">
          {error}
        </div>
      )}

      {/* Entity drill-down */}
      {entityView ? (
        <div className="p-2 space-y-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEntityView(null)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              ← back
            </button>
            <span className="text-xs font-semibold capitalize">
              {entityView.name}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {entityView.facts.length} live fact
              {entityView.facts.length !== 1 ? 's' : ''}
            </span>
          </div>
          <ul className="space-y-1.5">
            {entityView.facts.map((f) => (
              <FactRow
                key={f.factId}
                fact={f}
                threshold={threshold}
                apiKey={apiKey}
                onDelete={(id) => void removeFact(id)}
              />
            ))}
          </ul>
          {entityView.facts.length === 0 && (
            <p className="text-xs text-muted-foreground px-1">
              No live facts anchored to this entity.
            </p>
          )}
        </div>
      ) : (
        <div className="p-2 space-y-3">
          {/* Entities */}
          {entities.length > 0 && (
            <div>
              <h4 className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
                Entities
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {entities.map((e) => (
                  <EntityChip
                    key={e.entityId}
                    entity={e}
                    size="xs"
                    onClick={() => void openEntity(e.name)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Facts */}
          <div>
            <h4 className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
              {loading
                ? 'Loading…'
                : `${facts.length} fact${facts.length !== 1 ? 's' : ''}`}
            </h4>
            {facts.length === 0 && !loading ? (
              <p className="text-xs text-muted-foreground">
                {ready
                  ? 'No facts yet — they extract automatically after conversations.'
                  : 'Enter your API key and dataset above.'}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {facts.map((f) => (
                  <FactRow
                    key={f.factId}
                    fact={f}
                    threshold={threshold}
                    apiKey={apiKey}
                    onDelete={(id) => void removeFact(id)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

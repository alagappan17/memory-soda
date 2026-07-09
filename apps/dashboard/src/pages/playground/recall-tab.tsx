import { useEffect, useState } from 'react';
import type { RecallRequest, RecallResponse } from '@memory-soda/types';
import { trackedFetch, describeError } from './api';
import type { AddOp, RecallControls } from './types';
import { day } from '../../lib/fact-status';
import { FactRow } from './fact-row';

const DEFAULT_CONTROLS: RecallControls = {
  query: '',
  minConfidence: null,
  limit: null,
  includeEpisodes: true,
  includeSynthesis: true,
  includeRaw: true,
  asOf: '',
};

/**
 * Recall inspector — exercises POST /v1/memory/recall with every knob the API
 * accepts. Thread-free: only needs an API key + dataset.
 */
export function RecallTab({
  apiKey,
  dataset,
  active,
  addOp,
  defaultMinConfidence,
  defaultLimit,
  lastUserMessage,
}: {
  apiKey: string;
  dataset: string;
  active: boolean;
  addOp: AddOp;
  defaultMinConfidence: number | null;
  defaultLimit: number | null;
  lastUserMessage: string;
}) {
  const [controls, setControls] = useState<RecallControls>(DEFAULT_CONTROLS);
  const [result, setResult] = useState<RecallResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dataset-scoped: results are meaningless once the key or dataset changes.
  useEffect(() => {
    setResult(null);
    setError(null);
  }, [apiKey, dataset]);

  // Seed the query from the conversation the first time the tab opens.
  useEffect(() => {
    if (active && lastUserMessage) {
      setControls((c) => (c.query ? c : { ...c, query: lastUserMessage }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const ready = !!apiKey.trim() && !!dataset.trim();

  async function run() {
    if (!ready || loading) return;
    setLoading(true);
    setError(null);
    try {
      const include: NonNullable<RecallRequest['include']> = [];
      if (controls.includeEpisodes) include.push('episodes');
      if (controls.includeSynthesis) include.push('synthesis');
      if (controls.includeRaw) include.push('raw');

      const body: RecallRequest = {
        dataset: dataset.trim(),
        ...(controls.query.trim() ? { query: controls.query.trim() } : {}),
        ...(include.length ? { include } : {}),
        ...(controls.limit !== null ? { limit: controls.limit } : {}),
        ...(controls.minConfidence !== null
          ? { minConfidence: controls.minConfidence }
          : {}),
        ...(controls.asOf
          ? { asOf: new Date(controls.asOf).toISOString() }
          : {}),
      };

      const { data, trace } = await trackedFetch<RecallResponse>(
        apiKey,
        '/v1/memory/recall',
        { method: 'POST', body },
      );
      setResult(data);
      addOp(
        'recall',
        {
          factCount: data.factCount,
          contextChars: data.context.length,
          synthesis: Boolean(data.synthesis),
          episodes: data.episodes?.episodeCount ?? 0,
        },
        trace,
      );
    } catch (err) {
      const { message, trace } = describeError(err, 'Recall failed');
      setError(message);
      addOp('error', { message }, trace);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={active ? 'flex-1 overflow-y-auto min-h-0' : 'hidden'}>
      {/* Controls */}
      <div className="p-3 border-b border-border space-y-2.5 bg-card">
        <div className="flex items-center gap-2">
          <input
            value={controls.query}
            onChange={(e) =>
              setControls((c) => ({ ...c, query: e.target.value }))
            }
            onKeyDown={(e) => e.key === 'Enter' && void run()}
            placeholder="Retrieval query (blank = most recent facts)"
            className="flex-1 min-w-0 rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            onClick={() => void run()}
            disabled={!ready || loading}
            className="shrink-0 text-xs px-3 py-1 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {loading ? 'Recalling…' : 'Recall'}
          </button>
        </div>

        {/* minConfidence + limit */}
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={controls.minConfidence !== null}
              onChange={(e) =>
                setControls((c) => ({
                  ...c,
                  minConfidence: e.target.checked
                    ? (defaultMinConfidence ?? 0.5)
                    : null,
                }))
              }
            />
            minConfidence
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            disabled={controls.minConfidence === null}
            value={controls.minConfidence ?? defaultMinConfidence ?? 0.5}
            onChange={(e) =>
              setControls((c) => ({
                ...c,
                minConfidence: parseFloat(e.target.value),
              }))
            }
            className="flex-1 min-w-0 disabled:opacity-40"
          />
          <span className="text-[10px] font-mono text-muted-foreground w-14 shrink-0">
            {controls.minConfidence !== null
              ? controls.minConfidence.toFixed(2)
              : `${(defaultMinConfidence ?? 0.5).toFixed(2)}*`}
          </span>
          <label className="text-[10px] text-muted-foreground shrink-0">
            limit
          </label>
          <input
            type="number"
            min={1}
            max={100}
            value={controls.limit ?? ''}
            placeholder={defaultLimit !== null ? `${defaultLimit}*` : 'dflt'}
            onChange={(e) =>
              setControls((c) => ({
                ...c,
                limit: e.target.value
                  ? Math.max(1, Math.min(100, parseInt(e.target.value, 10)))
                  : null,
              }))
            }
            className="w-14 shrink-0 text-right rounded border border-input bg-background px-1.5 py-0.5 text-[10px] outline-none focus:ring-1 focus:ring-ring font-mono"
          />
        </div>

        {/* include toggles + asOf */}
        <div className="flex items-center gap-3 flex-wrap">
          {(
            [
              ['includeEpisodes', 'episodes'],
              ['includeSynthesis', 'synthesis'],
              ['includeRaw', 'raw'],
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer"
            >
              <input
                type="checkbox"
                checked={controls[key]}
                onChange={(e) =>
                  setControls((c) => ({ ...c, [key]: e.target.checked }))
                }
              />
              {label}
            </label>
          ))}
          <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground ml-auto">
            asOf
            <input
              type="datetime-local"
              value={controls.asOf}
              onChange={(e) =>
                setControls((c) => ({ ...c, asOf: e.target.value }))
              }
              className="rounded border border-input bg-background px-1.5 py-0.5 text-[10px] outline-none focus:ring-1 focus:ring-ring"
            />
            {controls.asOf && (
              <button
                onClick={() => setControls((c) => ({ ...c, asOf: '' }))}
                className="hover:text-foreground"
                title="Clear point-in-time"
              >
                ✕
              </button>
            )}
          </label>
        </div>
        <p className="text-[10px] text-muted-foreground">
          * = project default applies when unchecked/blank. asOf recalls facts
          as they were true at that instant.
        </p>
      </div>

      {/* Results */}
      {error && (
        <div className="mx-3 mt-2 px-3 py-2 rounded-md bg-destructive/10 text-destructive text-xs">
          {error}
        </div>
      )}
      {!result ? (
        <div className="flex items-center justify-center h-32 text-xs text-muted-foreground text-center px-4">
          {ready
            ? 'Run recall to inspect long-term memory. No thread required.'
            : 'Enter your API key and dataset above.'}
        </div>
      ) : (
        <div className="p-3 space-y-4">
          <div className="text-[10px] text-muted-foreground">
            {result.factCount} fact{result.factCount !== 1 ? 's' : ''} retrieved
          </div>

          {/* Rendered context */}
          <section>
            <h4 className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
              Context block
            </h4>
            {result.context ? (
              <pre className="whitespace-pre-wrap text-xs bg-muted/40 rounded-md p-2 border border-border">
                {result.context}
              </pre>
            ) : (
              <p className="text-xs text-muted-foreground">
                No facts yet — they extract automatically after conversations.
              </p>
            )}
          </section>

          {/* Synthesis */}
          {result.synthesis && (
            <section>
              <h4 className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                Synthesis
              </h4>
              <div className="text-xs bg-muted/40 rounded-md p-2 border border-border">
                {result.synthesis}
              </div>
            </section>
          )}

          {/* Entity-grouped facts */}
          {result.groups && result.groups.length > 0 && (
            <section>
              <h4 className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                Groups (by entity anchor)
              </h4>
              <div className="space-y-3">
                {result.groups.map((g) => (
                  <div key={g.entityName}>
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="text-xs font-semibold capitalize">
                        {g.entityName}
                      </span>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        relevance {g.groupRelevance.toFixed(3)}
                      </span>
                    </div>
                    <ul className="space-y-1">
                      {g.facts.map((f, i) => (
                        <li
                          key={i}
                          className="rounded-md border border-border px-3 py-1.5 text-xs"
                        >
                          <div className="flex items-baseline gap-2">
                            <span>
                              {f.subject}{' '}
                              <span className="text-muted-foreground">
                                {f.predicate}
                              </span>{' '}
                              {f.object}
                            </span>
                            <span className="text-[10px] font-mono text-muted-foreground ml-auto whitespace-nowrap">
                              {f.relevanceScore.toFixed(3)} · {day(f.validAt)}
                              {f.validUntil ? ` – ${day(f.validUntil)}` : ''}
                            </span>
                          </div>
                          {f.sourceQuote && (
                            <p className="text-[10px] text-muted-foreground italic mt-0.5 line-clamp-2">
                              “{f.sourceQuote}”
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Raw facts */}
          {result.facts && result.facts.length > 0 && (
            <section>
              <h4 className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                Raw facts
              </h4>
              <ul className="space-y-1.5">
                {result.facts.map((f) => (
                  <FactRow
                    key={f.factId}
                    fact={f}
                    threshold={
                      controls.minConfidence ?? defaultMinConfidence
                    }
                  />
                ))}
              </ul>
            </section>
          )}

          {/* Ranked episodes */}
          {result.episodes?.episodes && result.episodes.episodes.length > 0 && (
            <section>
              <h4 className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                Episodes ({result.episodes.episodeCount})
              </h4>
              <div className="space-y-2">
                {result.episodes.episodes.map((ep) => (
                  <div
                    key={ep.episodeId}
                    className="rounded-md border border-border px-3 py-2 text-xs"
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {ep.episodeId.slice(0, 8)}…
                      </span>
                      <span className="text-[10px] font-mono text-muted-foreground ml-auto">
                        relevance {ep.relevanceScore.toFixed(3)}
                      </span>
                    </div>
                    <p className="mt-1 text-muted-foreground leading-relaxed">
                      {ep.summary}
                    </p>
                    {ep.keyLearnings.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {ep.keyLearnings.map((l, i) => (
                          <li
                            key={i}
                            className="text-[10px] text-muted-foreground flex gap-1"
                          >
                            <span className="shrink-0">•</span>
                            <span>{l}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-1 text-[10px] font-mono text-muted-foreground">
                      {day(ep.startedAt)} → {day(ep.endedAt)}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

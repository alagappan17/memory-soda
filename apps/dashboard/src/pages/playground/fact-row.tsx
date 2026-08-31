import { useState } from 'react';
import type { Episode, SemanticFact } from '@memory-soda/types';
import { Trash2 } from 'lucide-react';
import { day, factStatus, FACT_STATUS_DOT } from '../../lib/fact-status';
import { quiet } from './api';

/**
 * A single fact row with bi-temporal status derived by the shared
 * factStatus() helper (also used by the datasets dossier).
 *
 * With `projectId`, clicking the row opens its lineage: the source quote, the
 * bi-temporal stamps, and the episode it was extracted from (fetched lazily).
 */
export function FactRow({
  fact,
  threshold,
  onDelete,
  projectId,
  badge,
}: {
  fact: SemanticFact;
  threshold: number | null;
  onDelete?: (factId: string) => void;
  projectId?: string;
  /** Small label after the triple, e.g. "new". */
  badge?: string;
}) {
  const { status, inactive } = factStatus(fact, threshold);
  const invalidated = status === 'invalidated';
  const rangeEnd = fact.validUntil ? ` – ${day(fact.validUntil)}` : '';
  const [open, setOpen] = useState(false);
  const [episode, setEpisode] = useState<Episode | 'loading' | 'error' | null>(
    null,
  );

  function toggle() {
    if (!projectId) return;
    const next = !open;
    setOpen(next);
    if (next && fact.episodeId && episode === null) {
      setEpisode('loading');
      quiet(projectId, (m) => m.getEpisode(fact.episodeId!))
        .then(setEpisode)
        .catch(() => setEpisode('error'));
    }
  }

  return (
    <li
      className={`group flex flex-col gap-1 rounded-md border border-border px-3 py-2 text-xs ${inactive ? 'opacity-50' : ''} ${projectId ? 'cursor-pointer' : ''}`}
      onClick={toggle}
    >
      <div className="flex items-center gap-2">
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${FACT_STATUS_DOT[status]}`}
        />
        <span className={invalidated ? 'line-through' : ''}>
          {fact.subject}{' '}
          <span className="text-muted-foreground">{fact.predicate}</span>{' '}
          {fact.object}
        </span>
        {badge && (
          <span className="text-[10px] px-1.5 rounded-sm bg-foreground text-background font-medium">
            {badge}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground ml-auto whitespace-nowrap">
          {fact.confidence.toFixed(2)} · {status} · {day(fact.validAt)}
          {rangeEnd}
        </span>
        {onDelete && !invalidated && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(fact.factId);
            }}
            aria-label="Delete fact"
            className="text-destructive opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            title="Delete fact (stamps invalidAt)"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {!open && fact.sourceQuote && (
        <p className="text-[10px] text-muted-foreground italic pl-3.5 line-clamp-2">
          “{fact.sourceQuote}”
        </p>
      )}
      {open && (
        <div
          className="pl-3.5 pt-1 space-y-1.5 text-[10px] text-muted-foreground cursor-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="grid grid-cols-[5rem_1fr] gap-x-2 gap-y-0.5 font-mono">
            <span>fact</span>
            <span className="truncate">{fact.factId}</span>
            <span>validAt</span>
            <span>{fact.validAt}</span>
            {fact.validUntil && (
              <>
                <span>validUntil</span>
                <span>{fact.validUntil}</span>
              </>
            )}
            {fact.invalidAt && (
              <>
                <span>invalidAt</span>
                <span>{fact.invalidAt}</span>
              </>
            )}
            {fact.relevanceScore !== undefined && (
              <>
                <span>relevance</span>
                <span>{fact.relevanceScore.toFixed(3)}</span>
              </>
            )}
          </div>
          {fact.sourceQuote && <p className="italic">“{fact.sourceQuote}”</p>}
          {!fact.episodeId ? (
            <p>No source episode (manually added).</p>
          ) : episode === 'loading' ? (
            <p>Loading episode…</p>
          ) : episode === 'error' ? (
            <p>Episode {fact.episodeId.slice(0, 8)}… not found.</p>
          ) : episode ? (
            <div className="rounded-md border border-border p-2 space-y-1">
              <p className="font-mono">
                episode {episode.episodeId.slice(0, 8)}… ·{' '}
                {episode.startedAt ? day(episode.startedAt) : '-'}
              </p>
              <p className="text-foreground/80">{episode.summary}</p>
            </div>
          ) : null}
        </div>
      )}
    </li>
  );
}

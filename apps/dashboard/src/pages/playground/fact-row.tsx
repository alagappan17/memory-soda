import type { SemanticFact } from '@memory-soda/types';
import { Trash2 } from 'lucide-react';
import { day, factStatus, FACT_STATUS_DOT } from '../../lib/fact-status';

/**
 * A single fact row with bi-temporal status derived by the shared
 * factStatus() helper (also used by the datasets dossier).
 */
export function FactRow({
  fact,
  threshold,
  onDelete,
}: {
  fact: SemanticFact;
  threshold: number | null;
  onDelete?: (factId: string) => void;
}) {
  const { status, inactive } = factStatus(fact, threshold);
  const invalidated = status === 'invalidated';
  const rangeEnd = fact.validUntil ? ` – ${day(fact.validUntil)}` : '';

  return (
    <li
      className={`group flex flex-col gap-1 rounded-md border border-border px-3 py-2 text-xs ${inactive ? 'opacity-50' : ''}`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${FACT_STATUS_DOT[status]}`}
        />
        <span className={invalidated ? 'line-through' : ''}>
          {fact.subject} <span className="text-muted-foreground">{fact.predicate}</span> {fact.object}
        </span>
        <span className="text-[10px] text-muted-foreground ml-auto whitespace-nowrap">
          {fact.confidence.toFixed(2)} · {status} · {day(fact.validAt)}
          {rangeEnd}
        </span>
        {onDelete && !invalidated && (
          <button
            onClick={() => onDelete(fact.factId)}
            aria-label="Delete fact"
            className="text-red-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            title="Delete fact (stamps invalidAt)"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {fact.sourceQuote && (
        <p className="text-[10px] text-muted-foreground italic pl-3.5 line-clamp-2">
          “{fact.sourceQuote}”
        </p>
      )}
    </li>
  );
}

import type { SemanticFact } from '@memory-soda/types';

export const day = (iso: string) => iso.slice(0, 10);

export type FactStatus =
  | 'valid'
  | 'expired'
  | 'invalidated'
  | 'below threshold';

/** Status dot color per bi-temporal state, shared by every fact list. */
export const FACT_STATUS_DOT: Record<FactStatus, string> = {
  valid: 'bg-foreground',
  expired: 'bg-muted-foreground',
  invalidated: 'bg-muted-foreground/40',
  'below threshold': 'bg-muted-foreground/40',
};

/**
 * Derive a fact's display status from its bi-temporal fields: invalidated
 * (soft-deleted/superseded) > expired (validUntil passed) > below the
 * retrieval confidence floor > valid.
 */
export function factStatus(
  fact: SemanticFact,
  threshold: number | null,
): { status: FactStatus; inactive: boolean } {
  const invalidated = fact.invalidAt !== null;
  const expired =
    !invalidated &&
    fact.validUntil !== null &&
    new Date(fact.validUntil) <= new Date();
  const belowThreshold = threshold !== null && fact.confidence < threshold;
  const status: FactStatus = invalidated
    ? 'invalidated'
    : expired
      ? 'expired'
      : belowThreshold
        ? 'below threshold'
        : 'valid';
  return { status, inactive: invalidated || expired || belowThreshold };
}

/**
 * Optimistic list update after a fact soft-delete: stamp invalidAt when
 * invalidated rows are visible, otherwise drop the row.
 */
export function applyFactDeletion(
  facts: SemanticFact[],
  factId: string,
  showInvalidated: boolean,
): SemanticFact[] {
  return showInvalidated
    ? facts.map((f) =>
        f.factId === factId ? { ...f, invalidAt: new Date().toISOString() } : f,
      )
    : facts.filter((f) => f.factId !== factId);
}

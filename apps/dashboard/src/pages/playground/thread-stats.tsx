import type { WMThreadStatsResponse } from '@memory-soda/types';

function formatSeconds(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

/** Compact strip surfacing GET /threads/:id/stats — tokens + session duration. */
export function ThreadStats({
  stats,
  onRefresh,
  loading,
}: {
  stats: WMThreadStatsResponse | null;
  onRefresh: () => void;
  loading: boolean;
}) {
  if (!stats) return null;
  const t = stats.tokenUsage;
  return (
    <div className="border-b border-border shrink-0 bg-card px-4 py-1.5 flex items-center gap-3 text-[10px] font-mono text-muted-foreground overflow-x-auto">
      <span className="font-sans font-medium">Stats</span>
      <span>{stats.messageCount} msgs</span>
      {t && (
        <>
          <span>↑{t.totalInput.toLocaleString()}</span>
          <span>↓{t.totalOutput.toLocaleString()}</span>
          <span>Σ{t.totalTokens.toLocaleString()}</span>
          <span>~{Math.round(t.averagePerMessage)}/msg</span>
        </>
      )}
      {stats.sessionDuration && (
        <span>{formatSeconds(stats.sessionDuration.seconds)}</span>
      )}
      <button
        onClick={onRefresh}
        disabled={loading}
        className="ml-auto font-sans text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
        title="Refresh thread stats"
      >
        ↻
      </button>
    </div>
  );
}

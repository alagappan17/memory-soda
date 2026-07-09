import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Episode,
  EpisodeStatus,
  EpisodeWithRelevance,
} from '@memory-soda/types';
import { EPISODE_STATUS_STYLES } from '../../lib/episode-status';
import { trackedFetch, describeError } from './api';
import { CopyButton } from '../../components/copy-button';
import type { AddOp } from './types';

const EPISODIC_BASE = '/v1/memory/episodic';

const STATUS_FILTERS: EpisodeStatus[] = [
  'completed',
  'pending',
  'processing',
  'failed',
];

type EpisodeRow = Episode & { relevanceScore?: number };

function fmt(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function EpisodeCard({
  episode,
  onRetry,
  onDelete,
}: {
  episode: EpisodeRow;
  onRetry: (episodeId: string) => void;
  onDelete: (episodeId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const s =
    EPISODE_STATUS_STYLES[episode.status] ?? EPISODE_STATUS_STYLES.pending;

  const processingMs =
    episode.processingStartedAt && episode.processingCompletedAt
      ? new Date(episode.processingCompletedAt).getTime() -
        new Date(episode.processingStartedAt).getTime()
      : null;

  return (
    <div
      className="rounded-md border border-border text-xs cursor-pointer select-none hover:bg-muted/40 transition-colors"
      onClick={() => setExpanded((v) => !v)}
    >
      <div className="flex items-start gap-2 px-3 py-2">
        <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${s.dot}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-medium text-foreground">{s.label}</span>
            {episode.relevanceScore !== undefined && (
              <span className="text-[10px] text-muted-foreground font-mono">
                rel {episode.relevanceScore.toFixed(3)}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground font-mono ml-auto shrink-0">
              {new Date(episode.createdAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
          {episode.summary ? (
            <p className="text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">
              {episode.summary}
            </p>
          ) : (
            <p className="text-muted-foreground/60 mt-0.5 italic">
              {episode.status === 'failed'
                ? (episode.error ?? 'Processing failed')
                : 'No summary yet'}
            </p>
          )}
        </div>
        <span className="text-muted-foreground text-[10px] shrink-0 mt-0.5">
          {expanded ? '▾' : '▸'}
        </span>
      </div>

      {expanded && (
        <div
          className="border-t border-border/50 mx-3 mb-2 pt-2 space-y-2 cursor-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {episode.keyLearnings && episode.keyLearnings.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
                Key Learnings
              </p>
              <ul className="space-y-0.5">
                {episode.keyLearnings.map((l, i) => (
                  <li
                    key={i}
                    className="text-[10px] text-muted-foreground flex gap-1"
                  >
                    <span className="shrink-0">•</span>
                    <span>{l}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-[7rem_1fr] gap-x-2 gap-y-0.5 text-[10px] font-mono text-muted-foreground">
            <span>id</span>
            <span className="flex items-center gap-1 min-w-0">
              <span className="truncate">{episode.episodeId}</span>
              <CopyButton
                text={episode.episodeId}
                title="Copy episode id"
                className="hover:text-foreground shrink-0"
              />
            </span>
            {episode.threadId && (
              <>
                <span>thread</span>
                <span className="truncate">{episode.threadId}</span>
              </>
            )}
            <span>messages</span>
            <span>{episode.messageCount}</span>
            {episode.tokenCount !== null && (
              <>
                <span>tokens</span>
                <span>{episode.tokenCount.toLocaleString()}</span>
              </>
            )}
            <span>window</span>
            <span>
              {fmt(episode.startedAt)} → {fmt(episode.endedAt)}
            </span>
            <span>processing</span>
            <span>
              {fmt(episode.processingStartedAt)} →{' '}
              {fmt(episode.processingCompletedAt)}
              {processingMs !== null && ` (${(processingMs / 1000).toFixed(1)}s)`}
            </span>
            {episode.retryCount > 0 && (
              <>
                <span>retries</span>
                <span>{episode.retryCount}</span>
              </>
            )}
            {episode.error && (
              <>
                <span>error</span>
                <span className="text-red-500 break-all">{episode.error}</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 pt-1">
            {episode.status === 'failed' && (
              <button
                onClick={() => onRetry(episode.episodeId)}
                className="text-[10px] px-2 py-1 rounded border border-border hover:bg-muted transition-colors"
              >
                ↺ Retry extraction
              </button>
            )}
            {episode.status !== 'archived' &&
              (confirmDelete ? (
                <span className="flex items-center gap-1.5 text-[10px]">
                  <button
                    onClick={() => onDelete(episode.episodeId)}
                    className="px-2 py-1 rounded bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
                  >
                    Confirm delete
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    cancel
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="text-[10px] px-2 py-1 rounded border border-border text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors"
                >
                  − Delete
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Episode browser: status-filtered list, semantic search, drill-down detail,
 * retry for failed extractions, soft-delete.
 */
export function EpisodesTab({
  apiKey,
  dataset,
  active,
  addOp,
  refreshKey,
  onWatchEpisode,
}: {
  apiKey: string;
  dataset: string;
  active: boolean;
  addOp: AddOp;
  /** Bumped by the extraction poller when new episodes complete. */
  refreshKey: number;
  onWatchEpisode: (episodeId: string) => void;
}) {
  const [episodes, setEpisodes] = useState<EpisodeRow[]>([]);
  const [status, setStatus] = useState<EpisodeStatus>('completed');
  const [searchQ, setSearchQ] = useState('');
  const [searchMode, setSearchMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedOnce = useRef(false);

  const ready = !!apiKey.trim() && !!dataset.trim();
  const base = `${EPISODIC_BASE}/datasets/${encodeURIComponent(dataset.trim())}`;

  const load = useCallback(
    async (opts: { silent?: boolean; statusOverride?: EpisodeStatus } = {}) => {
      if (!ready) return;
      setLoading(true);
      setError(null);
      const st = opts.statusOverride ?? status;
      try {
        const { data, trace } = await trackedFetch<{ episodes: Episode[] }>(
          apiKey,
          `${base}/episodes?status=${st}&limit=20`,
        );
        setEpisodes(data.episodes ?? []);
        setSearchMode(false);
        loadedOnce.current = true;
        if (!opts.silent) {
          addOp(
            'episodes_loaded',
            { count: (data.episodes ?? []).length, status: st },
            trace,
          );
        }
      } catch (err) {
        const { message, trace } = describeError(err, 'Failed to load episodes');
        setError(message);
        addOp('error', { message }, trace);
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apiKey, base, status, ready],
  );

  // Reset when the memory scope changes.
  useEffect(() => {
    setEpisodes([]);
    setSearchQ('');
    setSearchMode(false);
    setError(null);
    loadedOnce.current = false;
  }, [apiKey, dataset]);

  // Load on first open.
  useEffect(() => {
    if (active && !loadedOnce.current) void load({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, dataset]);

  // Poller-triggered refresh (silent — the poller already logged the event).
  useEffect(() => {
    if (refreshKey > 0 && loadedOnce.current && !searchMode) {
      void load({ silent: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  async function search() {
    if (!ready || !searchQ.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const { data, trace } = await trackedFetch<{
        episodes: EpisodeWithRelevance[];
      }>(
        apiKey,
        `${base}/episodes/search?q=${encodeURIComponent(searchQ.trim())}&limit=10`,
      );
      setEpisodes(data.episodes);
      setSearchMode(true);
      addOp(
        'episode_search',
        { q: searchQ.trim(), count: data.episodes.length },
        trace,
      );
    } catch (err) {
      const { message, trace } = describeError(err, 'Search failed');
      setError(message);
      addOp('error', { message }, trace);
    } finally {
      setLoading(false);
    }
  }

  async function retry(episodeId: string) {
    try {
      const { trace } = await trackedFetch<{
        episodeId: string;
        status: string;
      }>(apiKey, `${EPISODIC_BASE}/episodes/${episodeId}/retry`, {
        method: 'POST',
      });
      addOp('episode_retried', { episodeId }, trace);
      setEpisodes((prev) =>
        prev.map((e) =>
          e.episodeId === episodeId
            ? { ...e, status: 'pending' as EpisodeStatus, error: null }
            : e,
        ),
      );
      onWatchEpisode(episodeId);
    } catch (err) {
      const { message, trace } = describeError(err, 'Retry failed');
      setError(message);
      addOp('error', { message }, trace);
    }
  }

  async function remove(episodeId: string) {
    try {
      const { trace } = await trackedFetch<{
        episodeId: string;
        deleted: boolean;
      }>(apiKey, `${EPISODIC_BASE}/episodes/${episodeId}`, {
        method: 'DELETE',
      });
      addOp('episode_deleted', { episodeId }, trace);
      setEpisodes((prev) => prev.filter((e) => e.episodeId !== episodeId));
    } catch (err) {
      const { message, trace } = describeError(err, 'Delete failed');
      setError(message);
      addOp('error', { message }, trace);
    }
  }

  return (
    <div className={active ? 'flex-1 overflow-y-auto min-h-0' : 'hidden'}>
      {/* Controls */}
      <div className="p-2 border-b border-border space-y-2 bg-card">
        <div className="flex items-center gap-2">
          <input
            value={searchQ}
            onChange={(e) => {
              setSearchQ(e.target.value);
              if (!e.target.value && searchMode) void load({ silent: true });
            }}
            onKeyDown={(e) => e.key === 'Enter' && void search()}
            placeholder="Semantic search episodes…"
            className="flex-1 min-w-0 rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            onClick={() => void search()}
            disabled={!ready || !searchQ.trim() || loading}
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors shrink-0"
            title="Semantic search"
          >
            ⌕
          </button>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={status}
            onChange={(e) => {
              const st = e.target.value as EpisodeStatus;
              setStatus(st);
              void load({ statusOverride: st });
            }}
            disabled={searchMode}
            className="rounded border border-input bg-background px-2 py-1 text-[10px] outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {searchMode && (
            <button
              onClick={() => {
                setSearchQ('');
                void load({ silent: true });
              }}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              ✕ clear search
            </button>
          )}
          <span className="text-[10px] text-muted-foreground ml-auto">
            {loading
              ? 'Loading…'
              : `${episodes.length} episode${episodes.length !== 1 ? 's' : ''}`}
          </span>
          <button
            onClick={() => void load()}
            disabled={loading || !ready}
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
            title="Refresh episodes"
          >
            ↻
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-2 mt-2 px-3 py-2 rounded-md bg-destructive/10 text-destructive text-xs">
          {error}
        </div>
      )}

      {episodes.length === 0 && !loading ? (
        <div className="flex items-center justify-center h-32 text-xs text-muted-foreground text-center px-4">
          {ready
            ? searchMode
              ? 'No episodes matched the search.'
              : `No ${status} episodes yet. Episodes generate after inactivity or when a thread ends.`
            : 'Enter your API key and dataset above to view episodes.'}
        </div>
      ) : (
        <div className="p-2 space-y-2">
          {episodes.map((ep) => (
            <EpisodeCard
              key={ep.episodeId}
              episode={ep}
              onRetry={(id) => void retry(id)}
              onDelete={(id) => void remove(id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

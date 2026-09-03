import { useCallback, useEffect, useRef, useState } from 'react';
import type { Episode, EpisodeStatus } from '@memory-soda/types';
import { EPISODE_STATUS_STYLES } from '../../lib/episode-status';
import { call, adminCall, describeError } from './api';
import { CopyButton } from '../../components/copy-button';
import type { AddOp } from './types';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const STATUS_FILTERS: EpisodeStatus[] = [
  'completed',
  'pending',
  'processing',
  'failed',
];

type EpisodeRow = Episode & { relevanceScore?: number };

function fmt(iso: string | null): string {
  if (!iso) return '-';
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
              {processingMs !== null &&
                ` (${(processingMs / 1000).toFixed(1)}s)`}
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
                <span className="text-destructive break-all">
                  {episode.error}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 pt-1">
            {episode.status === 'failed' && (
              <Button
                variant="outline"
                size="xs"
                onClick={() => onRetry(episode.episodeId)}
              >
                ↺ Retry extraction
              </Button>
            )}
            {episode.status !== 'archived' &&
              (confirmDelete ? (
                <span className="flex items-center gap-1.5 text-[10px]">
                  <Button
                    variant="destructive"
                    size="xs"
                    onClick={() => onDelete(episode.episodeId)}
                  >
                    Confirm delete
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="text-muted-foreground"
                    onClick={() => setConfirmDelete(false)}
                  >
                    cancel
                  </Button>
                </span>
              ) : (
                <Button
                  variant="outline"
                  size="xs"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setConfirmDelete(true)}
                >
                  − Delete
                </Button>
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
  projectId,
  dataset,
  active,
  addOp,
  refreshKey,
  onWatchEpisode,
}: {
  projectId: string;
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

  const ready = !!projectId && !!dataset.trim();
  const scope = dataset.trim();

  const load = useCallback(
    async (opts: { silent?: boolean; statusOverride?: EpisodeStatus } = {}) => {
      if (!ready) return;
      setLoading(true);
      setError(null);
      const st = opts.statusOverride ?? status;
      try {
        const { data, trace } = await call(projectId, (memory) =>
          memory.listEpisodes(scope, { status: st, limit: 20 }),
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
        const { message, trace } = describeError(
          err,
          'Failed to load episodes',
        );
        setError(message);
        addOp('error', { message }, trace);
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, scope, status, ready],
  );

  // Reset when the memory scope changes.
  useEffect(() => {
    setEpisodes([]);
    setSearchQ('');
    setSearchMode(false);
    setError(null);
    loadedOnce.current = false;
  }, [projectId, dataset]);

  // Load on first open.
  useEffect(() => {
    if (active && !loadedOnce.current) void load({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, dataset]);

  // Poller-triggered refresh (silent, the poller already logged the event).
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
      const { data, trace } = await call(projectId, (memory) =>
        memory.searchEpisodes(scope, searchQ.trim(), { limit: 10 }),
      );
      setEpisodes(data);
      setSearchMode(true);
      addOp('episode_search', { q: searchQ.trim(), count: data.length }, trace);
    } catch (err) {
      const { message, trace } = describeError(err, 'Search failed');
      setError(message);
      addOp('error', { message }, trace);
    } finally {
      setLoading(false);
    }
  }

  async function retry(episodeId: string) {
    if (!projectId) return;
    try {
      // Re-running a failed background job is an operator action, so it is not
      // on the SDK, it goes over the dashboard's own session-authenticated
      // mount of the same route.
      const { trace } = await adminCall(
        projectId,
        'post',
        `/memory/episodic/episodes/${episodeId}/retry`,
      );
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
    if (!projectId) return;
    try {
      const { trace } = await adminCall(
        projectId,
        'delete',
        `/memory/episodic/episodes/${episodeId}`,
      );
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
          <Input
            value={searchQ}
            onChange={(e) => {
              setSearchQ(e.target.value);
              if (!e.target.value && searchMode) void load({ silent: true });
            }}
            onKeyDown={(e) => e.key === 'Enter' && void search()}
            placeholder="Semantic search episodes…"
            className="h-7 flex-1 min-w-0 text-xs md:text-xs"
          />
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            onClick={() => void search()}
            disabled={!ready || !searchQ.trim() || loading}
            title="Semantic search"
          >
            ⌕
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Select<EpisodeStatus>
            value={status}
            onValueChange={(st) => {
              if (!st) return;
              setStatus(st);
              void load({ statusOverride: st });
            }}
            disabled={searchMode}
          >
            <SelectTrigger className="h-6 w-auto min-w-24 px-2 text-[10px]">
              <SelectValue>{status}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((s) => (
                <SelectItem key={s} value={s} className="text-xs">
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {searchMode && (
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              onClick={() => {
                setSearchQ('');
                void load({ silent: true });
              }}
            >
              ✕ clear search
            </Button>
          )}
          <span className="text-[10px] text-muted-foreground ml-auto">
            {loading
              ? 'Loading…'
              : `${episodes.length} episode${episodes.length !== 1 ? 's' : ''}`}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            onClick={() => void load()}
            disabled={loading || !ready}
            title="Refresh episodes"
          >
            ↻
          </Button>
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
            : 'Select a project and dataset above to view episodes.'}
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

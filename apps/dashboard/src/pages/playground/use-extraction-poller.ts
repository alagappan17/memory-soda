import { useCallback, useEffect, useRef } from 'react';
import type { Episode } from '@memory-soda/types';
import { call, quiet } from './api';
import type { AddOp } from './types';

const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 90_000;
/** Buffer past the server's inactivity window before polling starts. */
const GRACE_MS = 2000;

/**
 * Watches the async extraction pipeline so it shows up in the ops log:
 * episode completes → fetch its facts → emit a "facts_extracted" op.
 *
 * Polling GETs are silent (not logged as ops). All async continuations are
 * guarded by a generation counter, bumped on reset, rather than the page's
 * currentRequestId, which guards user-initiated UI state.
 */
export function useExtractionPoller({
  projectId,
  dataset,
  addOp,
  onEpisodesChanged,
}: {
  projectId: string;
  dataset: string;
  addOp: AddOp;
  onEpisodesChanged: () => void;
}) {
  const genRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const knownRef = useRef<Set<string>>(new Set());
  const seededRef = useRef(false);
  const deadlineRef = useRef(0);
  const tickingRef = useRef(false);

  // Latest values for use inside timers without re-arming them.
  const projectRef = useRef(projectId);
  projectRef.current = projectId;
  const dsRef = useRef(dataset);
  dsRef.current = dataset;
  const addOpRef = useRef(addOp);
  addOpRef.current = addOp;
  const changedRef = useRef(onEpisodesChanged);
  changedRef.current = onEpisodesChanged;

  const stopTimers = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    genRef.current += 1;
    stopTimers();
    knownRef.current = new Set();
    seededRef.current = false;
    watchIdRef.current = null;
  }, [stopTimers]);

  // New project/dataset = new memory scope; drop any in-flight watch.
  useEffect(() => {
    reset();
  }, [projectId, dataset, reset]);

  useEffect(() => () => stopTimers(), [stopTimers]);

  const fetchEpisodes = useCallback(async (): Promise<Episode[]> => {
    const scope = dsRef.current.trim();
    const [completed, failed] = await Promise.all([
      quiet(projectRef.current, (memory) =>
        memory.listEpisodes(scope, { status: 'completed', limit: 20 }),
      ),
      quiet(projectRef.current, (memory) =>
        memory.listEpisodes(scope, { status: 'failed', limit: 10 }),
      ),
    ]);
    return [...(completed.episodes ?? []), ...(failed.episodes ?? [])];
  }, []);

  const seedBaseline = useCallback(
    async (gen: number) => {
      if (seededRef.current) return;
      try {
        const eps = await fetchEpisodes();
        if (gen !== genRef.current) return;
        for (const e of eps) knownRef.current.add(e.episodeId);
        seededRef.current = true;
      } catch {
        // Transient, the next attempt will seed.
      }
    },
    [fetchEpisodes],
  );

  const reportFacts = useCallback(async (episode: Episode, gen: number) => {
    try {
      const { data, trace } = await call(projectRef.current, (memory) =>
        memory.listFacts(dsRef.current.trim(), {
          episodeId: episode.episodeId,
          includeInvalidated: true,
          limit: 100,
        }),
      );
      if (gen !== genRef.current) return;
      addOpRef.current(
        'facts_extracted',
        { episodeId: episode.episodeId, count: data.facts.length },
        trace,
        {
          episode: {
            episodeId: episode.episodeId,
            summary: episode.summary,
            keyLearnings: episode.keyLearnings,
          },
          facts: data.facts,
        },
      );
    } catch {
      if (gen !== genRef.current) return;
      addOpRef.current('facts_extracted', {
        episodeId: episode.episodeId,
        count: '?',
      });
    }
  }, []);

  // When set, the poller watches this one episode via GET /episodes/:id
  // (retry flow) instead of diffing the dataset lists.
  const watchIdRef = useRef<string | null>(null);

  const settle = useCallback(
    async (ep: Episode, gen: number): Promise<boolean> => {
      if (ep.status === 'completed') {
        await reportFacts(ep, gen);
        return true;
      }
      if (ep.status === 'failed') {
        addOpRef.current('episode_failed', {
          episodeId: ep.episodeId,
          message: ep.error ?? 'extraction failed',
        });
        return true;
      }
      return false;
    },
    [reportFacts],
  );

  const tick = useCallback(
    async (gen: number) => {
      if (gen !== genRef.current || tickingRef.current) return;
      if (Date.now() > deadlineRef.current) {
        stopTimers();
        addOpRef.current('note', {
          message:
            'Extraction not observed within 90s, check the Episodes tab.',
        });
        return;
      }
      tickingRef.current = true;
      try {
        if (watchIdRef.current) {
          const watchId = watchIdRef.current;
          const episode = await quiet(projectRef.current, (memory) =>
            memory.getEpisode(watchId),
          );
          if (gen !== genRef.current) return;
          if (await settle(episode, gen)) {
            knownRef.current.add(episode.episodeId);
            watchIdRef.current = null;
            changedRef.current();
            stopTimers();
          }
          return;
        }

        const eps = await fetchEpisodes();
        if (gen !== genRef.current) return;
        const fresh = eps.filter((e) => !knownRef.current.has(e.episodeId));
        if (fresh.length === 0) return;
        for (const e of fresh) knownRef.current.add(e.episodeId);
        for (const ep of fresh) {
          await settle(ep, gen);
        }
        if (gen === genRef.current) {
          changedRef.current();
          stopTimers();
        }
      } catch {
        // Transient network error, keep polling until the deadline.
      } finally {
        tickingRef.current = false;
      }
    },
    [fetchEpisodes, settle, stopTimers],
  );

  const beginPolling = useCallback(
    (gen: number) => {
      if (gen !== genRef.current) return;
      stopTimers();
      deadlineRef.current = Date.now() + POLL_TIMEOUT_MS;
      intervalRef.current = setInterval(() => void tick(gen), POLL_INTERVAL_MS);
      void tick(gen);
    },
    [stopTimers, tick],
  );

  /**
   * Arm polling to begin after the server's inactivity window. Called on each
   * chat message, re-arming mirrors the server resetting its episode timer.
   */
  const schedule = useCallback(
    (inactivityMs: number) => {
      const gen = genRef.current;
      watchIdRef.current = null;
      void seedBaseline(gen);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(
        () => beginPolling(gen),
        inactivityMs + GRACE_MS,
      );
    },
    [beginPolling, seedBaseline],
  );

  /** Start polling immediately (thread end queued an episode). */
  const startNow = useCallback(() => {
    const gen = genRef.current;
    watchIdRef.current = null;
    void (async () => {
      await seedBaseline(gen);
      beginPolling(gen);
    })();
  }, [beginPolling, seedBaseline]);

  /** Watch one retried episode, a single precise GET per tick, no list diffing. */
  const watch = useCallback(
    (episodeId: string) => {
      knownRef.current.delete(episodeId);
      watchIdRef.current = episodeId;
      beginPolling(genRef.current);
    },
    [beginPolling],
  );

  return { schedule, startNow, watch, reset };
}

import { lt } from 'drizzle-orm';
import { db } from './db/postgres.js';
import { sessions } from './db/schema.js';
import {
  processScheduledEpisodes,
  retryFailedEpisodes,
} from './services/episodic-memory.service.js';
import { sweepSemanticMemory } from './services/semantic-memory.service.js';

/**
 * All background work, on one clock.
 *
 * There used to be three independent intervals firing into four overlapping
 * paths to the same job. One tick makes the ordering explicit, due episodes
 * first, then the two backstops, and means a slow sweep delays the next tick
 * instead of stacking up behind itself.
 *
 * Every job claims its own rows atomically, so running several API instances is
 * safe: they race for claims and the losers no-op.
 */

/** How often the tick runs. Due episodes are the latency-sensitive job. */
const TICK_MS = 5_000;

/** Backstops are cheap but pointless to run every tick. */
const BACKSTOP_EVERY = 24; // ~every 2 minutes

let timer: NodeJS.Timeout | null = null;
let ticks = 0;
let running = false;

async function tick(): Promise<void> {
  // A tick that overruns must not have a second copy started on top of it.
  if (running) return;
  running = true;
  try {
    await run('scheduled episodes', processScheduledEpisodes);

    if (ticks % BACKSTOP_EVERY === 0) {
      await run('episode retries', retryFailedEpisodes);
      await run('semantic sweep', sweepSemanticMemory);
      await run('expired sessions', purgeExpiredSessions);
    }
  } finally {
    ticks++;
    running = false;
  }
}

/** One job's failure must not stop the others in the same tick. */
async function run(name: string, job: () => Promise<void>): Promise<void> {
  try {
    await job();
  } catch (err) {
    console.error(`[worker] ${name} failed:`, err);
  }
}

/**
 * Expired and revoked sessions are dead weight, they are rejected on read, so
 * keeping them only grows the table.
 */
async function purgeExpiredSessions(): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

export function startWorker(): void {
  if (timer) return;
  // unref: a pending tick must never hold the process open on shutdown.
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref();
}

export function stopWorker(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

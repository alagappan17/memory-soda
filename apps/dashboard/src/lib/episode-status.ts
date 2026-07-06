import type { EpisodeStatus } from '@memory-soda/types';

/** Shared status → {dot, badge, label} styling for episodes across the dashboard. */
export const EPISODE_STATUS_STYLES: Record<
  EpisodeStatus,
  { dot: string; badge: string; label: string }
> = {
  completed: { dot: 'bg-green-500', badge: 'bg-green-500/10 text-green-600 dark:text-green-400', label: 'Completed' },
  pending: { dot: 'bg-yellow-400', badge: 'bg-yellow-400/10 text-yellow-600 dark:text-yellow-400', label: 'Pending' },
  processing: { dot: 'bg-blue-500 animate-pulse', badge: 'bg-blue-500/10 text-blue-600 dark:text-blue-400', label: 'Processing' },
  failed: { dot: 'bg-red-500', badge: 'bg-red-500/10 text-red-600 dark:text-red-400', label: 'Failed' },
  archived: { dot: 'bg-muted-foreground/40', badge: 'bg-muted text-muted-foreground', label: 'Archived' },
  deleted: { dot: 'bg-muted-foreground/40', badge: 'bg-muted text-muted-foreground', label: 'Deleted' },
};

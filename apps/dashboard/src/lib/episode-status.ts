import type { EpisodeStatus } from '@memory-soda/types';

/** Shared status → {dot, badge, label} styling for episodes across the dashboard. */
export const EPISODE_STATUS_STYLES: Record<
  EpisodeStatus,
  { dot: string; badge: string; label: string }
> = {
  completed: {
    dot: 'bg-foreground',
    badge: 'border border-border text-foreground',
    label: 'Completed',
  },
  pending: {
    dot: 'bg-muted-foreground/50',
    badge: 'border border-border text-muted-foreground',
    label: 'Pending',
  },
  processing: {
    dot: 'bg-foreground animate-pulse',
    badge: 'border border-border text-foreground',
    label: 'Processing',
  },
  failed: {
    dot: 'bg-destructive',
    badge: 'bg-destructive/10 text-destructive',
    label: 'Failed',
  },
  archived: {
    dot: 'bg-muted-foreground/40',
    badge: 'bg-muted text-muted-foreground',
    label: 'Archived',
  },
  deleted: {
    dot: 'bg-muted-foreground/40',
    badge: 'bg-muted text-muted-foreground',
    label: 'Deleted',
  },
};

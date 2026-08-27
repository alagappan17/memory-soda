import { z } from 'zod';

/**
 * Parse a boolish query-string value.
 *
 * `z.coerce.boolean()` treats every non-empty string as true, so
 * `?includeInvalidated=false` would mean the opposite of what it says. Only
 * "true" and "1" count.
 */
export const boolish = z.preprocess(
  (v) => v === true || v === 'true' || v === '1',
  z.boolean(),
);

/** A dataset key: the caller's identifier for one memory store. */
export const datasetKey = z.string().min(1).max(256);

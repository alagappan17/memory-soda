import { ENTITY_TYPES, type EntityType } from '@memory-soda/types';

/**
 * Deterministic clean-up applied to everything the extraction model returns.
 *
 * These run after the LLM and before anything is stored, so they are the last
 * line of defence against a model that ignores the prompt. Pure and
 * dependency-free on purpose, this is the behaviour worth testing.
 */

/** Caps applied post-LLM so one runaway fact can't bloat every context block. */
export const MAX_OBJECT_LEN = 500;
export const MAX_QUOTE_LEN = 200;

function isEntityType(value: string): value is EntityType {
  return (ENTITY_TYPES as readonly string[]).includes(value);
}

/** Coerce a model-supplied type to a known one, defaulting to THING. */
export function normalizeEntityType(type: string): EntityType {
  return isEntityType(type) ? type : 'THING';
}

/**
 * Validate a model-supplied date into a normalized ISO YYYY-MM-DD string, or
 * null. Guards against the model echoing the "YYYY-MM-DD or null" placeholder,
 * empty strings, and unparseable junk.
 */
export function sanitizeDate(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s.length === 0 || /null|yyyy/i.test(s)) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Trim and cap a supporting quote; empty becomes null rather than "". */
export function sanitizeQuote(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length === 0 ? null : s.slice(0, MAX_QUOTE_LEN);
}

/**
 * Canonical predicate form: lowercase, punctuation stripped, whitespace
 * collapsed. Two phrasings of the same predicate must normalize identically or
 * contradiction detection will not see them as the same claim.
 */
export function normalizePredicate(predicate: string): string {
  return predicate
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}_\s]/gu, '')
    .replace(/\s+/g, ' ');
}

/** Lowercase, trim and cap an entity or object name. */
export function normalizeName(value: string): string {
  return value.toLowerCase().trim().slice(0, MAX_OBJECT_LEN);
}

/** Confidence is stored, never used to drop, clamp to [0, 1] for sanity. */
export function clampConfidence(c: number): number {
  return Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 1;
}

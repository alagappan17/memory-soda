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

// ── Shapes ────────────────────────────────────────────────────────────────────

export interface ExtractedEntity {
  name: string;
  type: EntityType;
}

interface FactCommon {
  subject: string;
  predicate: string;
  /** Model-rated confidence (0–1). Stored on the fact; filtered at retrieval. */
  confidence: number;
  /** Verbatim supporting quote from the transcript; null when the model gave none. */
  sourceQuote: string | null;
  /** Valid-time bounds (ISO YYYY-MM-DD) when the user states them; else null. */
  validFrom: string | null;
  validUntil: string | null;
}

export interface ExtractedRelationship extends FactCommon {
  object: string;
}

export interface ExtractedLiteralFact extends FactCommon {
  value: string;
}

export interface ExtractedGraph {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
  literalFacts: ExtractedLiteralFact[];
}

/** What the model actually returns, before any normalisation. */
export interface RawGraph extends Omit<ExtractedGraph, 'entities'> {
  entities: { name: string; type: string }[];
}

// ── Field normalisers ─────────────────────────────────────────────────────────

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

// ── Graph assembly ────────────────────────────────────────────────────────────

/**
 * Turn the model's raw output into a graph the store can hold. Decides, without
 * trusting the model, which facts are edges and which are attributes, and which
 * subjects are allowed at all.
 *
 * Subject rule: "user", or an entity the user is linked to, either by a
 * relationship in this same batch or because it is already in the store
 * (`known`). That is what lets memory be a graph (user → owns → honda civic,
 * honda civic → has mileage → 120,000 km) while still rejecting encyclopedia
 * content about things the user has no stated connection to.
 */
export function assembleGraph(
  raw: RawGraph,
  known: ExtractedEntity[] = [],
): ExtractedGraph {
  const entities: ExtractedEntity[] = [];
  const entityNames = new Set<string>();
  for (const e of raw.entities) {
    const name = normalizeName(e.name);
    if (name.length === 0 || entityNames.has(name)) continue;
    entities.push({ name, type: normalizeEntityType(e.type) });
    entityNames.add(name);
  }
  // The user is the central subject ("user" is canonical and scoped per
  // dataset); a synthetic entity guarantees user facts pass the name check even
  // when the model omits it.
  if (!entityNames.has('user')) {
    entities.push({ name: 'user', type: 'PERSON' });
    entityNames.add('user');
  }
  const knownNames = new Set(known.map((k) => normalizeName(k.name)));

  const common = (f: FactCommon): FactCommon => ({
    subject: normalizeName(f.subject),
    predicate: normalizePredicate(f.predicate),
    confidence: clampConfidence(f.confidence),
    sourceQuote: sanitizeQuote(f.sourceQuote),
    validFrom: sanitizeDate(f.validFrom),
    validUntil: sanitizeDate(f.validUntil),
  });

  // Whether a fact is an edge or an attribute is decided by the entity list,
  // not by which array the model put it in: the model routinely puts "user
  // bought asics novablast 5" in literalFacts (which would leave the fact
  // unlinked from the entity) and "user has movie nights on → fridays" in
  // relationships without co-listing "fridays" (which would create a phantom
  // entity, or lose the fact).
  const relationships: ExtractedRelationship[] = [];
  const literalFacts: ExtractedLiteralFact[] = [];
  const place = (f: FactCommon, objectOrValue: string) => {
    const value = objectOrValue.trim();
    if (value.length === 0) return;
    const asName = normalizeName(value);
    if (entityNames.has(asName) || knownNames.has(asName)) {
      relationships.push({ ...common(f), object: asName });
    } else {
      literalFacts.push({
        ...common(f),
        value: value.slice(0, MAX_OBJECT_LEN),
      });
    }
  };
  for (const r of raw.relationships) place(r, r.object);
  for (const f of raw.literalFacts) place(f, f.value);

  const userLinked = new Set(
    relationships.filter((r) => r.subject === 'user').map((r) => r.object),
  );
  const allowedSubject = (s: string) =>
    s === 'user' || userLinked.has(s) || knownNames.has(s);
  const rels = relationships.filter(
    (r) => allowedSubject(r.subject) && r.subject !== r.object,
  );
  const lits = literalFacts.filter((f) => allowedSubject(f.subject));

  // An entity no surviving fact touches is noise the model listed and never
  // used; inserting it would leave orphan nodes in the graph.
  const referenced = new Set<string>(['user']);
  for (const r of rels) {
    referenced.add(r.subject);
    referenced.add(r.object);
  }
  for (const f of lits) referenced.add(f.subject);

  return {
    entities: entities.filter((e) => referenced.has(e.name)),
    relationships: rels,
    literalFacts: lits,
  };
}

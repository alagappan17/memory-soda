import {
  and,
  eq,
  isNull,
  isNotNull,
  or,
  desc,
  sql,
  inArray,
  gte,
  lte,
  lt,
  gt,
  count,
} from 'drizzle-orm';
import { db } from '../db/postgres.js';
import {
  episodes,
  facts,
  entities,
  messages,
  projects,
  threads,
  isLiveFact,
  isLiveFactAsOf,
} from '../db/schema.js';
import type { NewFactRow } from '../db/schema.js';
import { batchEmbedTexts, buildTranscript } from '../lib/gemini.js';
import {
  extractGraph,
  resolveContradictions,
  type ContradictionPair,
  type ExtractedEntity,
  type ExtractedGraph,
} from '../lib/semantic-extraction.js';
import { mergeWithDefaults } from '../lib/project-settings.js';
import type {
  ProjectSemanticSettings,
  ProjectSettingsPatch,
  SemanticContext,
  SemanticEntity,
  SemanticFact,
  RankedContextGroup,
} from '@memory-soda/types';

// Give up on an episode's semantic extraction after this many failures.
const MAX_SEMANTIC_RETRIES = 3;

// A 'processing' claim older than this is considered orphaned (the worker died
// mid-extraction — crash, restart, deploy) and may be reclaimed.
const STALE_PROCESSING_MS = 10 * 60 * 1000;

// Contradiction candidates: live facts on the same anchor whose embedding
// similarity to the candidate is at least this (but below the dedup threshold,
// where they'd be near-duplicates instead). Catches paraphrased predicates
// ("works at" vs "is employed by") that exact matching misses.
const CONTRADICTION_BAND_MIN = 0.8;

// Query→entity anchor matching by vector similarity: how similar an entity must
// be to the query, and how many such entities to admit.
const ANCHOR_VECTOR_MIN = 0.75;
const ANCHOR_VECTOR_TOP_K = 3;

// ── Settings ──────────────────────────────────────────────────────────────────

/** Drop null/undefined values so a partial JSONB override can't erase project defaults. */
function stripNullish<T extends object>(raw: Partial<T> | null | undefined): Partial<T> {
  if (!raw) return {};
  return Object.fromEntries(
    Object.entries(raw).filter(([, v]) => v !== null && v !== undefined),
  ) as Partial<T>;
}

/** Effective semantic settings: project defaults overlaid with any per-thread override. */
export async function getEffectiveSemanticSettings(
  projectId: string,
  threadOverride?: Partial<ProjectSemanticSettings> | null,
): Promise<ProjectSemanticSettings> {
  const [projRow] = await db
    .select({ settings: projects.settings })
    .from(projects)
    .where(eq(projects.id, projectId));
  const base = mergeWithDefaults(
    projRow?.settings as ProjectSettingsPatch | null,
  ).semantic;
  return { ...base, ...stripNullish(threadOverride) };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * The entity a fact is anchored to (derived, never stored): the object when it
 * is an entity (user → interested in → asus rog anchors on "asus rog"), else
 * the subject ("user") for literal attributes with no entity to anchor to.
 */
export function anchorFor(f: {
  subject: string;
  object: string;
  objectIsEntity: boolean;
}): string {
  return f.objectIsEntity ? f.object : f.subject;
}

/**
 * Enriched embedding string for a fact. Appending the anchor entity makes it
 * more prominent in vector space, improving entity-centric retrieval.
 */
export function buildFactEmbedString(f: {
  subject: string;
  predicate: string;
  object: string;
  objectIsEntity: boolean;
}): string {
  return `${f.subject} ${f.predicate} ${f.object}. About: ${anchorFor(f)}.`;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

const factKey = (s: string, p: string, o: string) => `${s}|${p}|${o}`;

const toVectorLiteral = (emb: number[]) => `[${emb.join(',')}]`;

// ── Pipeline entry point ────────────────────────────────────────────────────────
//
// Five steps: extract → resolve entities → dedup → evolve (contradictions) → write.
// Runs async off an episode reaching `completed`, on the episode's raw messages.

export async function processSemanticMemory(episodeId: string): Promise<void> {
  const now = new Date();

  // Atomic claim: only one worker moves pending/failed → processing. A stale
  // 'processing' row (worker died mid-extraction) may also be reclaimed.
  const staleBefore = new Date(now.getTime() - STALE_PROCESSING_MS);
  const [episode] = await db
    .update(episodes)
    .set({ semanticStatus: 'processing', updatedAt: now })
    .where(
      and(
        eq(episodes.id, episodeId),
        or(
          inArray(episodes.semanticStatus, ['pending', 'failed']),
          and(
            eq(episodes.semanticStatus, 'processing'),
            lt(episodes.updatedAt, staleBefore),
          ),
        ),
      ),
    )
    .returning();
  if (!episode) return;

  try {
    const [[projRow], [tRow]] = await Promise.all([
      db
        .select({ settings: projects.settings })
        .from(projects)
        .where(eq(projects.id, episode.projectId)),
      episode.threadId
        ? db
            .select({ semanticSettings: threads.semanticSettings })
            .from(threads)
            .where(eq(threads.id, episode.threadId))
        : Promise.resolve([]),
    ]);
    const projectSettings = mergeWithDefaults(
      projRow?.settings as ProjectSettingsPatch | null,
    );
    const settings: ProjectSemanticSettings = {
      ...projectSettings.semantic,
      ...stripNullish(
        tRow?.semanticSettings as Partial<ProjectSemanticSettings> | null,
      ),
    };
    if (!settings.enabled) {
      await db
        .update(episodes)
        .set({ semanticStatus: 'skipped', updatedAt: new Date() })
        .where(eq(episodes.id, episodeId));
      return;
    }

    // Raw messages — scoped to the episode's stamped sequence range so multiple
    // episodes on one thread don't re-extract each other's messages. Legacy
    // episodes (NULL range) fall back to the whole uncompacted thread.
    const scope =
      episode.startSequence !== null && episode.endSequence !== null
        ? and(
            gte(messages.sequenceNumber, episode.startSequence),
            lte(messages.sequenceNumber, episode.endSequence),
          )
        : isNull(messages.compactedAt);
    const msgRows = episode.threadId
      ? await db
          .select({ role: messages.role, content: messages.content })
          .from(messages)
          .where(and(eq(messages.threadId, episode.threadId), scope))
          .orderBy(sql`${messages.sequenceNumber} ASC`)
      : [];

    if (msgRows.length === 0) {
      await db
        .update(episodes)
        .set({ semanticStatus: 'completed', updatedAt: new Date() })
        .where(eq(episodes.id, episodeId));
      return;
    }

    // Bounded transcript — direct signal beats the lossy summary, but a long
    // episode must not blow the extraction prompt (head + tail truncation).
    const transcript = buildTranscript(
      msgRows,
      projectSettings.episodic.maxMessages,
    );

    // Step 1 — extract (pass `now` as the anchor for resolving relative dates)
    const graph = await extractGraph(transcript, settings.minConfidence, now);

    // Step 2 — resolve entities (dedup the entities table)
    const canonical = await resolveEntities(
      episode.userId,
      episode.projectId,
      graph.entities,
      settings,
    );

    // Steps 3–5 — dedup, evolve contradictions, write
    await writeFacts(
      {
        userId: episode.userId,
        projectId: episode.projectId,
        episodeId: episode.id,
      },
      graph,
      settings,
      now,
      canonical,
    );

    await db
      .update(episodes)
      .set({ semanticStatus: 'completed', error: null, updatedAt: new Date() })
      .where(eq(episodes.id, episodeId));
  } catch (err) {
    console.error('[semantic] processSemanticMemory failed:', episodeId, err);
    await db
      .update(episodes)
      .set({
        semanticStatus: 'failed',
        semanticRetryCount: sql`${episodes.semanticRetryCount} + 1`,
        error: `[semantic] ${err instanceof Error ? err.message : String(err)}`,
        updatedAt: new Date(),
      })
      .where(eq(episodes.id, episodeId));
  }
}

// ── Step 2: entity resolution ───────────────────────────────────────────────────

async function resolveEntities(
  userId: string,
  projectId: string,
  extracted: ExtractedEntity[],
  settings: ProjectSemanticSettings,
): Promise<Map<string, string>> {
  // raw extracted name → canonical stored name, so fact writes can converge aliases.
  const canonical = new Map<string, string>();
  if (extracted.length === 0) return canonical;

  const tenant = and(
    eq(entities.userId, userId),
    eq(entities.projectId, projectId),
  );
  const newEmbeds = await batchEmbedTexts(extracted.map((e) => e.name));

  for (let i = 0; i < extracted.length; i++) {
    const ent = extracted[i];
    const emb = newEmbeds[i];

    // Exact name match → this is the canonical entity.
    const [exact] = await db
      .select({ id: entities.id, name: entities.name })
      .from(entities)
      .where(and(tenant, eq(entities.name, ent.name)));
    if (exact) {
      await db
        .update(entities)
        .set({ updatedAt: new Date() })
        .where(eq(entities.id, exact.id));
      canonical.set(ent.name, exact.name);
      continue;
    }

    // Nearest existing entity of the SAME TYPE via pgvector — type-aware so
    // "apple" (ORG) never merges into "apple" (FOOD). `<=>` is cosine distance;
    // similarity = 1 - distance.
    const vec = toVectorLiteral(emb);
    const [nearest] = await db
      .select({
        id: entities.id,
        name: entities.name,
        distance: sql<number>`${entities.embedding} <=> ${vec}::vector`,
      })
      .from(entities)
      .where(and(tenant, eq(entities.type, ent.type), isNotNull(entities.embedding)))
      .orderBy(sql`${entities.embedding} <=> ${vec}::vector`)
      .limit(1);

    if (nearest && 1 - nearest.distance >= settings.entityResolutionThreshold) {
      await db
        .update(entities)
        .set({ updatedAt: new Date() })
        .where(eq(entities.id, nearest.id));
      canonical.set(ent.name, nearest.name);
    } else {
      // Upsert — concurrent semantic workers may insert the same
      // (userId, projectId, name); the unique index would otherwise fail the job.
      const [row] = await db
        .insert(entities)
        .values({
          userId,
          projectId,
          name: ent.name,
          type: ent.type,
          embedding: emb,
        })
        .onConflictDoUpdate({
          target: [entities.userId, entities.projectId, entities.name],
          set: { updatedAt: new Date() },
        })
        .returning({ id: entities.id, name: entities.name });
      canonical.set(ent.name, row.name);
    }
  }

  return canonical;
}

// ── Steps 3–5: dedup, evolve, write ─────────────────────────────────────────────

interface FactCandidate {
  subject: string;
  predicate: string;
  object: string;
  objectIsEntity: boolean;
  sourceQuote: string | null;
  /** Valid-time bounds (ISO strings) from extraction; null when open-ended. */
  validFrom: string | null;
  validUntil: string | null;
}

async function writeFacts(
  ctx: { userId: string; projectId: string; episodeId: string },
  graph: ExtractedGraph,
  settings: ProjectSemanticSettings,
  now: Date,
  canonical: Map<string, string>,
): Promise<void> {
  const { userId, projectId, episodeId } = ctx;
  const canon = (name: string) => canonical.get(name) ?? name;

  // Literal facts + relationships flow into the same table. Subject/object are
  // rewritten to their canonical entity name so aliases (e.g. "bob"/"robert")
  // converge and stay discoverable via entity-anchored retrieval.
  const candidates: FactCandidate[] = [
    ...graph.literalFacts.map((f) => ({
      subject: canon(f.subject),
      predicate: f.predicate,
      object: f.value,
      objectIsEntity: false,
      sourceQuote: f.sourceQuote,
      validFrom: f.validFrom,
      validUntil: f.validUntil,
    })),
    ...graph.relationships.map((r) => ({
      subject: canon(r.subject),
      predicate: r.predicate,
      object: canon(r.object),
      objectIsEntity: true,
      sourceQuote: r.sourceQuote,
      validFrom: r.validFrom,
      validUntil: r.validUntil,
    })),
  ];
  if (candidates.length === 0) return;

  const tenant = and(eq(facts.userId, userId), eq(facts.projectId, projectId));

  // Existing live facts for this tenant (the dedup/contradiction baseline).
  // `snapshotAt` marks the read so the write transaction can detect facts a
  // concurrent job committed while we were off calling the LLM.
  const snapshotAt = new Date();
  const live = await db
    .select({
      id: facts.id,
      subject: facts.subject,
      predicate: facts.predicate,
      object: facts.object,
      objectIsEntity: facts.objectIsEntity,
      sourceQuote: facts.sourceQuote,
      validAt: facts.validAt,
      embedding: facts.embedding,
    })
    .from(facts)
    .where(and(tenant, isLiveFact));

  // Step 3 — drop exact duplicates (vs live + within this batch).
  const liveExact = new Set(live.map((f) => factKey(f.subject, f.predicate, f.object)));
  const seen = new Set<string>();
  const deduped = candidates.filter((c) => {
    const k = factKey(c.subject, c.predicate, c.object);
    if (liveExact.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (deduped.length === 0) return;

  // Valid-time bounds. Extraction already normalized these to ISO date strings or
  // null, so parsing is safe.
  const toDate = (iso: string | null): Date | null =>
    iso ? new Date(iso) : null;

  // Effective valid-from instant. validFrom is date-only, so "today" resolves to
  // midnight — hours BEFORE facts recorded earlier the same day, which would make
  // a brand-new statement look older than what it supersedes (and the judge would
  // wrongly keep the old fact). A same-day validFrom therefore means "now".
  const today = now.toISOString().slice(0, 10);
  const effectiveValidAt = (validFrom: string | null): Date => {
    const d = toDate(validFrom);
    if (!d) return now;
    return validFrom === today ? now : d;
  };

  // Embed candidates (enriched with the derived anchor).
  const embeds = await batchEmbedTexts(deduped.map(buildFactEmbedString));

  // Step 3b — drop near-duplicates by embedding similarity (no LLM), against
  // live facts AND earlier candidates in this batch (paraphrase pairs like
  // "wants large screen" / "prefers big display" arrive together).
  const survivors: { c: FactCandidate; emb: number[] }[] = [];
  deduped.forEach((c, i) => {
    const emb = embeds[i];
    const nearLive = live.some(
      (f) =>
        f.embedding &&
        cosine(emb, f.embedding as number[]) >= settings.factDedupThreshold,
    );
    const nearBatch = survivors.some(
      (s) => cosine(emb, s.emb) >= settings.factDedupThreshold,
    );
    if (!nearLive && !nearBatch) survivors.push({ c, emb });
  });

  // Step 4 — collect (survivor ↔ conflicting live fact) pairs, then resolve all
  // contradictions in ONE batched LLM call. A live fact conflicts when it states
  // a different object for the same predicate ("works at google" vs "works at
  // anthropic"), or is a paraphrase-level neighbour by embedding (band below the
  // dedup threshold) — which catches predicate rewordings like "works at" vs
  // "is employed by". Historical candidates (validUntil already past) never
  // supersede anything — they are inserted as history without judging.
  const conflictRefs: { survivorIndex: number; oldId: string }[] = [];
  const pairs: ContradictionPair[] = [];
  survivors.forEach(({ c, emb }, si) => {
    const historical = c.validUntil !== null && new Date(c.validUntil) <= now;
    if (historical) return;
    const newValidAt = effectiveValidAt(c.validFrom).toISOString();
    for (const f of live) {
      const samePredicateConflict =
        f.predicate === c.predicate && f.object !== c.object;
      const bandConflict =
        !samePredicateConflict &&
        f.embedding !== null &&
        (() => {
          const sim = cosine(emb, f.embedding as number[]);
          return sim >= CONTRADICTION_BAND_MIN && sim < settings.factDedupThreshold;
        })();
      if (!samePredicateConflict && !bandConflict) continue;
      conflictRefs.push({ survivorIndex: si, oldId: f.id });
      pairs.push({
        subject: c.subject,
        oldPredicate: f.predicate,
        oldObject: f.object,
        oldValidAt: f.validAt.toISOString(),
        oldQuote: f.sourceQuote,
        newPredicate: c.predicate,
        newObject: c.object,
        newValidAt,
        newQuote: c.sourceQuote,
      });
    }
  });

  const verdicts = await resolveContradictions(pairs);

  // Reconcile verdicts per survivor: a survivor superseded by ANY existing fact
  // ('new' verdict) is discarded entirely — including its 'old' verdicts.
  // Otherwise a survivor could invalidate an old fact and then never be
  // inserted, vaporizing the knowledge.
  const supersededSurvivors = new Set<number>();
  verdicts.forEach((verdict, k) => {
    if (verdict === 'new') supersededSurvivors.add(conflictRefs[k].survivorIndex);
  });
  const invalidationsBySurvivor = new Map<number, string[]>();
  verdicts.forEach((verdict, k) => {
    const ref = conflictRefs[k];
    if (verdict === 'old' && !supersededSurvivors.has(ref.survivorIndex)) {
      const list = invalidationsBySurvivor.get(ref.survivorIndex) ?? [];
      list.push(ref.oldId);
      invalidationsBySurvivor.set(ref.survivorIndex, list);
    }
  });

  const staged = survivors
    .map((s, si) => ({ ...s, si }))
    .filter(({ si }) => !supersededSurvivors.has(si));
  if (staged.length === 0) return;

  // Step 5 — apply atomically, serialized per tenant via an advisory lock so
  // concurrent episode jobs can't interleave their invalidate/insert. The
  // live-facts partial unique index + ON CONFLICT DO NOTHING is the final
  // backstop against duplicates.
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:${projectId}`}))`,
    );

    // Race re-check: facts committed by a concurrent job after our snapshot
    // never went through this batch's dedup/contradiction pass. Drop staged
    // survivors that now collide exactly or state the same anchor+predicate.
    const appeared = await tx
      .select({
        subject: facts.subject,
        predicate: facts.predicate,
        object: facts.object,
      })
      .from(facts)
      .where(and(tenant, isLiveFact, gt(facts.createdAt, snapshotAt)));
    const appearedExact = new Set(
      appeared.map((f) => factKey(f.subject, f.predicate, f.object)),
    );
    const appearedSubjPred = new Set(
      appeared.map((f) => `${f.subject}|${f.predicate}`),
    );
    const finalStaged = staged.filter(
      ({ c }) =>
        !appearedExact.has(factKey(c.subject, c.predicate, c.object)) &&
        !appearedSubjPred.has(`${c.subject}|${c.predicate}`),
    );
    if (finalStaged.length === 0) return;

    // Only apply invalidations belonging to survivors that are actually inserted.
    const invalidatedIds = new Set<string>(
      finalStaged.flatMap(({ si }) => invalidationsBySurvivor.get(si) ?? []),
    );

    // Renewal: an expired-but-not-superseded row (valid_until in the past,
    // invalid_at NULL) still occupies the live-unique index. A new statement of
    // the same fact supersedes it — stamp it so the insert can land.
    const renewalConds = finalStaged.map(({ c }) =>
      and(
        eq(facts.subject, c.subject),
        eq(facts.predicate, c.predicate),
        eq(facts.object, c.object),
      ),
    );
    await tx
      .update(facts)
      .set({ invalidAt: now, updatedAt: now })
      .where(
        and(
          tenant,
          isNull(facts.invalidAt),
          isNotNull(facts.validUntil),
          lte(facts.validUntil, now),
          or(...renewalConds),
        ),
      );

    if (invalidatedIds.size > 0) {
      await tx
        .update(facts)
        .set({ invalidAt: now, updatedAt: now })
        .where(inArray(facts.id, [...invalidatedIds]));
    }

    const toInsert: NewFactRow[] = finalStaged.map(({ c, emb }) => ({
      userId,
      projectId,
      subject: c.subject,
      predicate: c.predicate,
      object: c.object,
      objectIsEntity: c.objectIsEntity,
      sourceQuote: c.sourceQuote,
      episodeId,
      validAt: effectiveValidAt(c.validFrom),
      validUntil: toDate(c.validUntil),
      embedding: emb,
    }));
    await tx.insert(facts).values(toInsert).onConflictDoNothing();
  });
}

// ── Sweep job ───────────────────────────────────────────────────────────────────

/**
 * Backstop sweep: processes episodes whose semantic extraction is pending (the
 * completion trigger was missed, or a migration reset them) or failed (bounded
 * by MAX_SEMANTIC_RETRIES). Runs on an interval from main.ts.
 */
export async function sweepSemanticMemory(): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);
  const rows = await db
    .select({ id: episodes.id })
    .from(episodes)
    .where(
      and(
        // Archived included: an episode can be archived (by the next episode on
        // its thread) before its semantic pass ran — its message window would
        // otherwise never be extracted.
        inArray(episodes.status, ['completed', 'archived']),
        or(
          inArray(episodes.semanticStatus, ['pending', 'failed']),
          // Orphaned claims from a dead worker.
          and(
            eq(episodes.semanticStatus, 'processing'),
            lt(episodes.updatedAt, staleBefore),
          ),
        ),
        lt(episodes.semanticRetryCount, MAX_SEMANTIC_RETRIES),
      ),
    )
    .orderBy(episodes.createdAt)
    .limit(20);
  for (const row of rows) {
    // Sequential on purpose — these each fan out LLM + embedding calls.
    try {
      await processSemanticMemory(row.id);
    } catch (err) {
      console.error('[semantic] sweep failed:', row.id, err);
    }
  }
}

// ── Retrieval (read path) ────────────────────────────────────────────────────

const FACT_COLUMNS = {
  id: facts.id,
  subject: facts.subject,
  predicate: facts.predicate,
  object: facts.object,
  objectIsEntity: facts.objectIsEntity,
  sourceQuote: facts.sourceQuote,
  validAt: facts.validAt,
  validUntil: facts.validUntil,
  invalidAt: facts.invalidAt,
  episodeId: facts.episodeId,
} as const;

type FactSelect = {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  objectIsEntity: boolean;
  sourceQuote: string | null;
  validAt: Date;
  validUntil: Date | null;
  invalidAt: Date | null;
  episodeId: string | null;
};

function rowToSemanticFact(r: FactSelect, relevanceScore?: number): SemanticFact {
  return {
    factId: r.id,
    subject: r.subject,
    predicate: r.predicate,
    object: r.object,
    objectIsEntity: r.objectIsEntity,
    sourceQuote: r.sourceQuote,
    validAt: r.validAt.toISOString(),
    validUntil: r.validUntil ? r.validUntil.toISOString() : null,
    invalidAt: r.invalidAt ? r.invalidAt.toISOString() : null,
    episodeId: r.episodeId,
    ...(relevanceScore !== undefined ? { relevanceScore } : {}),
  };
}

/** Reciprocal Rank Fusion across ranked id lists. Higher score = more relevant. */
function reciprocalRankFusion(lists: string[][], k = 60): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, idx) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + idx + 1));
    });
  }
  return scores;
}

// Keyword search expression — MUST stay identical to the facts_tsv_idx GIN
// index expression in the migration SQL for the planner to use the index.
const factsTsv = sql`to_tsvector('english', coalesce(${facts.subject}, '') || ' ' || coalesce(${facts.predicate}, '') || ' ' || coalesce(${facts.object}, ''))`;

/**
 * Hybrid fact retrieval: vector similarity + entity-anchored lookup + keyword
 * (full-text), fused with Reciprocal Rank Fusion. Entity-anchor is the reliability
 * net — it surfaces facts tied to a named entity even when no lexical/semantic
 * bridge exists (e.g. "trip to Thailand" → "favorite food is mango sticky rice").
 */
export async function getSemanticContext(
  userId: string,
  projectId: string,
  query: string | undefined,
  limit: number,
  queryEmbedding?: number[] | null,
): Promise<SemanticContext> {
  const tenant = and(
    eq(facts.userId, userId),
    eq(facts.projectId, projectId),
    isLiveFact,
  );
  const scan = Math.max(limit * 4, 20);
  const byId = new Map<string, FactSelect>();
  const record = (rows: FactSelect[]) => rows.forEach((r) => byId.set(r.id, r));

  // No query → most recent live facts.
  if (!query || query.trim().length === 0) {
    const rows = (await db
      .select(FACT_COLUMNS)
      .from(facts)
      .where(tenant)
      .orderBy(desc(facts.validAt))
      .limit(limit)) as FactSelect[];
    return {
      facts: rows.map((r) => rowToSemanticFact(r, 1)),
      factCount: rows.length,
    };
  }

  // Signal 1 — vector similarity.
  const vectorSignal = async (): Promise<FactSelect[]> => {
    if (!queryEmbedding || queryEmbedding.length === 0) return [];
    const vectorLiteral = toVectorLiteral(queryEmbedding);
    return (await db
      .select(FACT_COLUMNS)
      .from(facts)
      .where(and(tenant, isNotNull(facts.embedding)))
      .orderBy(sql`${facts.embedding} <=> ${vectorLiteral}::vector`)
      .limit(scan)) as FactSelect[];
  };

  // Signal 2 — entity-anchored: resolve entities the query mentions (word-boundary
  // match, so "art" can't fire inside "start") plus the query's nearest entities
  // by embedding, then pull every live fact touching those names.
  const anchorSignal = async (): Promise<FactSelect[]> => {
    const entityTenant = and(
      eq(entities.userId, userId),
      eq(entities.projectId, projectId),
    );
    const mentionRows = await db
      .select({ name: entities.name })
      .from(entities)
      .where(
        and(
          entityTenant,
          sql`${query} ~* ('\\m' || regexp_replace(${entities.name}, '([^a-zA-Z0-9 ])', '\\\\\\1', 'g') || '\\M')`,
        ),
      );
    const vectorRows =
      queryEmbedding && queryEmbedding.length > 0
        ? await db
            .select({ name: entities.name })
            .from(entities)
            .where(
              and(
                entityTenant,
                isNotNull(entities.embedding),
                sql`1 - (${entities.embedding} <=> ${toVectorLiteral(queryEmbedding)}::vector) >= ${ANCHOR_VECTOR_MIN}`,
              ),
            )
            .orderBy(
              sql`${entities.embedding} <=> ${toVectorLiteral(queryEmbedding)}::vector`,
            )
            .limit(ANCHOR_VECTOR_TOP_K)
        : [];
    const anchors = [
      ...new Set([...mentionRows, ...vectorRows].map((r) => r.name)),
    ];
    if (anchors.length === 0) return [];
    return (await db
      .select(FACT_COLUMNS)
      .from(facts)
      .where(
        and(
          tenant,
          or(inArray(facts.subject, anchors), inArray(facts.object, anchors)),
        ),
      )
      .limit(scan)) as FactSelect[];
  };

  // Signal 3 — keyword / full-text.
  const keywordSignal = async (): Promise<FactSelect[]> => {
    const tsquery = sql`plainto_tsquery('english', ${query})`;
    return (await db
      .select(FACT_COLUMNS)
      .from(facts)
      .where(and(tenant, sql`${factsTsv} @@ ${tsquery}`))
      .orderBy(sql`ts_rank(${factsTsv}, ${tsquery}) DESC`)
      .limit(scan)) as FactSelect[];
  };

  // The three signals are independent — run them in one round-trip.
  const signalResults = await Promise.all([
    vectorSignal(),
    anchorSignal(),
    keywordSignal(),
  ]);

  const lists: string[][] = signalResults.map((rows) => {
    record(rows);
    return rows.map((r) => r.id);
  });

  // Fuse and take the top `limit`.
  const fused = reciprocalRankFusion(lists);
  const ranked = [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  const resultFacts = ranked
    .map(([id, score]) => {
      const row = byId.get(id);
      return row ? rowToSemanticFact(row, score) : null;
    })
    .filter((f): f is SemanticFact => f !== null);

  return { facts: resultFacts, factCount: resultFacts.length };
}

// ── Context assembly + render ────────────────────────────────────────────────

/** Group facts by their derived anchor entity, sorted by relevance. */
export function assembleContext(factList: SemanticFact[]): RankedContextGroup[] {
  const groupMap = new Map<string, RankedContextGroup>();
  for (const fact of factList) {
    const key = anchorFor(fact);
    let group = groupMap.get(key);
    if (!group) {
      group = { entityName: key, facts: [], groupRelevance: 0 };
      groupMap.set(key, group);
    }
    const score = fact.relevanceScore ?? 1;
    group.facts.push({
      subject: fact.subject,
      predicate: fact.predicate,
      object: fact.object,
      sourceQuote: fact.sourceQuote,
      validAt: fact.validAt,
      validUntil: fact.validUntil,
      relevanceScore: score,
    });
    if (score > group.groupRelevance) group.groupRelevance = score;
  }
  const groups = [...groupMap.values()];
  for (const g of groups) g.facts.sort((a, b) => b.relevanceScore - a.relevanceScore);
  groups.sort((a, b) => b.groupRelevance - a.groupRelevance);
  return groups;
}

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

/** Collapse control characters so fact text can't break out of the rendered block. */
function oneLine(value: unknown): string {
  return String(value).replace(/[\r\n\t]+/g, ' ').trim();
}

/**
 * Render grouped facts into a prompt-ready text block (the primary prepare()
 * output). Deterministic, no LLM. Mirrors Zep's basic context-block shape.
 */
export function renderContext(
  groups: RankedContextGroup[],
  entityList: SemanticEntity[] = [],
): string {
  if (groups.length === 0) return '';

  const lines: string[] = [
    'Known facts about the user, most relevant first.',
    '',
    '# FACTS  (format: fact (valid: from – to))',
  ];
  for (const g of groups) {
    for (const f of g.facts) {
      const until = f.validUntil ? formatDate(f.validUntil) : 'present';
      lines.push(
        `- ${oneLine(f.subject)} ${oneLine(f.predicate)} ${oneLine(f.object)}  (valid: ${formatDate(f.validAt)} – ${until})`,
      );
    }
  }

  if (entityList.length > 0) {
    lines.push('', '# ENTITIES');
    for (const e of entityList) {
      lines.push(`- ${oneLine(e.name)} (${oneLine(e.type)})`);
    }
  }

  return lines.join('\n');
}

/** Fetch entity records for a set of names (for the ENTITIES render section). */
export async function getEntitiesByName(
  userId: string,
  projectId: string,
  names: string[],
): Promise<SemanticEntity[]> {
  const wanted = names.filter((n) => n.length > 0 && n !== 'user');
  if (wanted.length === 0) return [];
  const rows = await db
    .select({ id: entities.id, name: entities.name, type: entities.type })
    .from(entities)
    .where(
      and(
        eq(entities.userId, userId),
        eq(entities.projectId, projectId),
        inArray(entities.name, wanted),
      ),
    );
  return rows.map((r) => ({
    entityId: r.id,
    name: r.name,
    type: r.type as SemanticEntity['type'],
  }));
}

// ── Dashboard / SDK read APIs ────────────────────────────────────────────────

export async function querySemanticFacts(
  userId: string,
  projectId: string,
  opts: {
    q?: string;
    limit?: number;
    includeInvalidated?: boolean;
    /** Point-in-time filter: facts that were true at this instant. Overrides includeInvalidated. */
    asOf?: Date;
  } = {},
): Promise<{ facts: SemanticFact[]; total: number }> {
  const limit = opts.limit ?? 50;
  const conds = [eq(facts.userId, userId), eq(facts.projectId, projectId)];
  if (opts.asOf) conds.push(isLiveFactAsOf(opts.asOf));
  else if (!opts.includeInvalidated) conds.push(isLiveFact);
  if (opts.q && opts.q.trim().length > 0) {
    conds.push(sql`${factsTsv} @@ plainto_tsquery('english', ${opts.q})`);
  }
  const where = and(...conds);
  const [rows, [totalRow]] = await Promise.all([
    db
      .select(FACT_COLUMNS)
      .from(facts)
      .where(where)
      .orderBy(desc(facts.validAt))
      .limit(limit) as Promise<FactSelect[]>,
    db.select({ count: count() }).from(facts).where(where),
  ]);
  return {
    facts: rows.map((r) => rowToSemanticFact(r)),
    total: totalRow?.count ?? rows.length,
  };
}

export async function listEntities(
  userId: string,
  projectId: string,
): Promise<SemanticEntity[]> {
  const rows = await db
    .select({ id: entities.id, name: entities.name, type: entities.type })
    .from(entities)
    .where(and(eq(entities.userId, userId), eq(entities.projectId, projectId)))
    .orderBy(desc(entities.updatedAt));
  return rows.map((r) => ({
    entityId: r.id,
    name: r.name,
    type: r.type as SemanticEntity['type'],
  }));
}

export async function listEntityFacts(
  userId: string,
  projectId: string,
  name: string,
): Promise<SemanticFact[]> {
  const rows = (await db
    .select(FACT_COLUMNS)
    .from(facts)
    .where(
      and(
        eq(facts.userId, userId),
        eq(facts.projectId, projectId),
        isLiveFact,
        or(eq(facts.subject, name), eq(facts.object, name)),
      ),
    )
    .orderBy(desc(facts.validAt))) as FactSelect[];
  return rows.map((r) => rowToSemanticFact(r));
}

/** Soft-delete a fact by stamping invalidAt. Returns false if not found. */
export async function softDeleteFact(
  userId: string,
  projectId: string,
  factId: string,
): Promise<boolean> {
  const now = new Date();
  const updated = await db
    .update(facts)
    .set({ invalidAt: now, updatedAt: now })
    .where(
      and(
        eq(facts.id, factId),
        eq(facts.userId, userId),
        eq(facts.projectId, projectId),
        isNull(facts.invalidAt),
      ),
    )
    .returning({ id: facts.id });
  return updated.length > 0;
}

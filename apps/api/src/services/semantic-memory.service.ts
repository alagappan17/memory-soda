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
import type { FactRow, NewFactRow } from '../db/schema.js';
import { batchEmbedTexts } from '../lib/gemini.js';
import { buildTranscript } from '../lib/transcript.js';
import {
  extractGraph,
  resolveContradictions,
  type ContradictionPair,
  type ExtractedEntity,
  type ExtractedGraph,
} from '../lib/semantic-extraction.js';

import {
  anchorFor,
  buildFactEmbedString,
  cosine,
  reciprocalRankFusion,
} from '../lib/fact-context.js';
import { mergeWithDefaults } from '@memory-soda/types';
import type {
  ProjectSemanticSettings,
  SemanticContext,
  SemanticEntity,
  SemanticFact,
} from '@memory-soda/types';

// Give up on an episode's semantic extraction after this many failures.
const MAX_SEMANTIC_RETRIES = 3;

// A 'processing' claim older than this is considered orphaned (the worker died
// mid-extraction — crash, restart, deploy) and may be reclaimed.
const STALE_PROCESSING_MS = 10 * 60 * 1000;

// ── Settings ──────────────────────────────────────────────────────────────────

/** Drop null/undefined values so a partial JSONB override can't erase project defaults. */
function stripNullish<T extends object>(
  raw: Partial<T> | null | undefined,
): Partial<T> {
  const out: Partial<T> = {};
  if (!raw) return out;
  // Object.keys is typed string[] regardless of the object — the one place
  // this function needs to state what it already knows.
  for (const key of Object.keys(raw) as (keyof T)[]) {
    const value = raw[key];
    if (value !== null && value !== undefined) out[key] = value;
  }
  return out;
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
  const base = mergeWithDefaults(projRow?.settings).semantic;
  return { ...base, ...stripNullish(threadOverride) };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const factKey = (s: string, p: string, o: string) => `${s}|${p}|${o}`;

/**
 * Whether two facts are similar enough to be worth judging for contradiction
 * but not so similar they are the same fact.
 *
 * The band exists to catch predicate rewordings — "works at" versus "is
 * employed by" — that an exact predicate match misses and deduplication would
 * wrongly swallow.
 */
function inContradictionBand(
  similarity: number,
  settings: ProjectSemanticSettings,
): boolean {
  return (
    similarity >= settings.contradictionBandMin &&
    similarity < settings.factDedupThreshold
  );
}

const toVectorLiteral = (emb: number[]) => `[${emb.join(',')}]`;

/**
 * How many nearest live facts to pull per candidate when judging duplicates and
 * contradictions. Anything past the closest handful is, by definition, not
 * similar enough to be either.
 */
const NEIGHBOUR_SCAN = 10;

/** A live fact in a candidate's neighbourhood; `similarity` only when vector-matched. */
interface LiveNeighbour {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  sourceQuote: string | null;
  validAt: Date;
  similarity?: number;
}

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
    const projectSettings = mergeWithDefaults(projRow?.settings);
    const settings: ProjectSemanticSettings = {
      ...projectSettings.semantic,
      ...stripNullish(tRow?.semanticSettings),
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
    const graph = await extractGraph(transcript, now);

    // Step 2 — resolve entities (dedup the entities table)
    const canonical = await resolveEntities(
      episode.dataset,
      episode.projectId,
      graph.entities,
      settings,
    );

    // Steps 3–5 — dedup, evolve contradictions, write
    await writeFacts(
      {
        dataset: episode.dataset,
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
  dataset: string,
  projectId: string,
  extracted: ExtractedEntity[],
  settings: ProjectSemanticSettings,
): Promise<Map<string, string>> {
  // raw extracted name → canonical stored name, so fact writes converge aliases.
  const canonical = new Map<string, string>();
  if (extracted.length === 0) return canonical;

  const tenant = and(
    eq(entities.dataset, dataset),
    eq(entities.projectId, projectId),
  );

  // One embedding call, then pair each entity with its vector — indexing two
  // arrays in step is how they silently drift apart.
  const embeddings = await batchEmbedTexts(extracted.map((e) => e.name));
  const candidates = extracted.flatMap((ent, i) => {
    const embedding = embeddings[i];
    return embedding ? [{ ent, embedding }] : [];
  });

  // Exact matches for the whole batch in one query rather than one per entity.
  const names = [...new Set(candidates.map((c) => c.ent.name))];
  const exactRows = await db
    .select({ id: entities.id, name: entities.name })
    .from(entities)
    .where(and(tenant, inArray(entities.name, names)));
  const exactByName = new Map(exactRows.map((r) => [r.name, r]));

  const touched = new Set<string>();
  const unresolved: typeof candidates = [];
  for (const candidate of candidates) {
    const exact = exactByName.get(candidate.ent.name);
    if (exact) {
      canonical.set(candidate.ent.name, exact.name);
      touched.add(exact.id);
    } else {
      unresolved.push(candidate);
    }
  }

  // Nearest existing entity of the SAME TYPE via pgvector — type-aware so
  // "apple" (ORG) never merges into "apple" (FOOD). `<=>` is cosine distance,
  // so similarity is 1 - distance. Each needs its own vector, so these run
  // concurrently rather than in sequence.
  const nearestMatches = await Promise.all(
    unresolved.map(async ({ ent, embedding }) => {
      const vec = toVectorLiteral(embedding);
      const [nearest] = await db
        .select({
          id: entities.id,
          name: entities.name,
          distance: sql<number>`${entities.embedding} <=> ${vec}::vector`,
        })
        .from(entities)
        .where(
          and(tenant, eq(entities.type, ent.type), isNotNull(entities.embedding)),
        )
        .orderBy(sql`${entities.embedding} <=> ${vec}::vector`)
        .limit(1);

      const merged =
        nearest && 1 - nearest.distance >= settings.entityResolutionThreshold
          ? nearest
          : null;
      return { ent, embedding, merged };
    }),
  );

  const toInsert = new Map<string, ExtractedEntity & { embedding: number[] }>();
  for (const { ent, embedding, merged } of nearestMatches) {
    if (merged) {
      canonical.set(ent.name, merged.name);
      touched.add(merged.id);
    } else {
      // Deduplicated by name: Postgres rejects an INSERT whose ON CONFLICT
      // target is hit twice by the same statement.
      toInsert.set(ent.name, { ...ent, embedding });
    }
  }

  if (touched.size > 0) {
    await db
      .update(entities)
      .set({ updatedAt: new Date() })
      .where(inArray(entities.id, [...touched]));
  }

  if (toInsert.size > 0) {
    // Upsert: a concurrent worker may have inserted the same
    // (dataset, projectId, name) since the reads above.
    const inserted = await db
      .insert(entities)
      .values(
        [...toInsert.values()].map((e) => ({
          dataset,
          projectId,
          name: e.name,
          type: e.type,
          embedding: e.embedding,
        })),
      )
      .onConflictDoUpdate({
        target: [entities.dataset, entities.projectId, entities.name],
        set: { updatedAt: new Date() },
      })
      .returning({ name: entities.name });
    for (const row of inserted) canonical.set(row.name, row.name);
  }

  return canonical;
}

// ── Steps 3–5: dedup, evolve, write ─────────────────────────────────────────────

interface FactCandidate {
  subject: string;
  predicate: string;
  object: string;
  objectIsEntity: boolean;
  /** Model-rated confidence; stored on the row, filtered at retrieval. */
  confidence: number;
  sourceQuote: string | null;
  /** Valid-time bounds (ISO strings) from extraction; null when open-ended. */
  validFrom: string | null;
  validUntil: string | null;
}

async function writeFacts(
  ctx: { dataset: string; projectId: string; episodeId: string },
  graph: ExtractedGraph,
  settings: ProjectSemanticSettings,
  now: Date,
  canonical: Map<string, string>,
): Promise<void> {
  const { dataset, projectId, episodeId } = ctx;
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
      confidence: f.confidence,
      sourceQuote: f.sourceQuote,
      validFrom: f.validFrom,
      validUntil: f.validUntil,
    })),
    ...graph.relationships.map((r) => ({
      subject: canon(r.subject),
      predicate: r.predicate,
      object: canon(r.object),
      objectIsEntity: true,
      confidence: r.confidence,
      sourceQuote: r.sourceQuote,
      validFrom: r.validFrom,
      validUntil: r.validUntil,
    })),
  ];
  if (candidates.length === 0) return;

  const tenant = and(eq(facts.dataset, dataset), eq(facts.projectId, projectId));

  // `snapshotAt` marks the start of the read set so the write transaction can
  // detect facts a concurrent job committed while we were off calling the LLM.
  const snapshotAt = new Date();

  // Step 3 — drop exact duplicates, against what is already live and within
  // this batch. One indexed lookup on the exact triples, rather than loading
  // the dataset to compare in memory.
  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    const k = factKey(c.subject, c.predicate, c.object);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const existingExact = await db
    .select({
      subject: facts.subject,
      predicate: facts.predicate,
      object: facts.object,
    })
    .from(facts)
    .where(
      and(
        tenant,
        isLiveFact,
        or(
          ...unique.map((c) =>
            and(
              eq(facts.subject, c.subject),
              eq(facts.predicate, c.predicate),
              eq(facts.object, c.object),
            ),
          ),
        ),
      ),
    );
  const liveExact = new Set(
    existingExact.map((f) => factKey(f.subject, f.predicate, f.object)),
  );
  const deduped = unique.filter(
    (c) => !liveExact.has(factKey(c.subject, c.predicate, c.object)),
  );
  if (deduped.length === 0) return;

  // Valid-time bounds. Extraction already normalized these to ISO date strings
  // or null, so parsing is safe.
  const toDate = (iso: string | null): Date | null => (iso ? new Date(iso) : null);

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

  // Step 3b — the neighbourhood of each candidate, from Postgres.
  //
  // This used to load every live fact for the dataset into Node, with its
  // 768-float embedding, and compare in JavaScript — O(candidates × facts) work
  // and a working set that grew without bound. pgvector already has an ivfflat
  // index on this column; asking it for the nearest few rows per candidate is
  // both exact enough and bounded by the number of candidates.
  const neighbourhoods = await Promise.all(
    deduped.map(async (candidate, i) => {
      const emb = embeds[i];
      if (!emb) return { candidate, emb: null, neighbours: [] };
      const vec = toVectorLiteral(emb);
      const neighbours = await db
        .select({
          id: facts.id,
          subject: facts.subject,
          predicate: facts.predicate,
          object: facts.object,
          sourceQuote: facts.sourceQuote,
          validAt: facts.validAt,
          similarity: sql<number>`1 - (${facts.embedding} <=> ${vec}::vector)`,
        })
        .from(facts)
        .where(and(tenant, isLiveFact, isNotNull(facts.embedding)))
        .orderBy(sql`${facts.embedding} <=> ${vec}::vector`)
        .limit(NEIGHBOUR_SCAN);
      return { candidate, emb, neighbours };
    }),
  );

  // Same-predicate conflicts are a lexical match, not a vector one, so they get
  // their own indexed lookup — a fact stating a different object for the same
  // predicate must be judged even when its embedding is far away.
  const samePredicateLive = await db
    .select({
      id: facts.id,
      subject: facts.subject,
      predicate: facts.predicate,
      object: facts.object,
      sourceQuote: facts.sourceQuote,
      validAt: facts.validAt,
    })
    .from(facts)
    .where(
      and(
        tenant,
        isLiveFact,
        or(
          ...deduped.map((c) =>
            and(eq(facts.subject, c.subject), eq(facts.predicate, c.predicate)),
          ),
        ),
      ),
    );

  // Drop near-duplicates by embedding similarity, against live facts and
  // against earlier candidates in this batch (paraphrase pairs like "wants
  // large screen" / "prefers big display" arrive together).
  const survivors: { c: FactCandidate; emb: number[] }[] = [];
  const survivorNeighbours: LiveNeighbour[][] = [];
  for (const { candidate, emb, neighbours } of neighbourhoods) {
    if (!emb) continue;
    const nearLive = neighbours.some(
      (n) => n.similarity >= settings.factDedupThreshold,
    );
    const nearBatch = survivors.some(
      (existing) => cosine(emb, existing.emb) >= settings.factDedupThreshold,
    );
    if (nearLive || nearBatch) continue;

    survivors.push({ c: candidate, emb });
    survivorNeighbours.push([
      ...neighbours,
      ...samePredicateLive.filter(
        (f) =>
          f.subject === candidate.subject && f.predicate === candidate.predicate,
      ),
    ]);
  }
  if (survivors.length === 0) return;

  // Step 4 — collect (survivor ↔ conflicting live fact) pairs, then resolve all
  // contradictions in ONE batched LLM call. A live fact conflicts when it states
  // a different object for the same predicate ("works at google" vs "works at
  // anthropic"), or is a paraphrase-level neighbour by embedding (band below the
  // dedup threshold) — which catches predicate rewordings like "works at" vs
  // "is employed by". Historical candidates (validUntil already past) never
  // supersede anything — they are inserted as history without judging.
  const conflictRefs: { survivorIndex: number; oldId: string }[] = [];
  const pairs: ContradictionPair[] = [];
  survivors.forEach(({ c }, si) => {
    const historical = c.validUntil !== null && new Date(c.validUntil) <= now;
    if (historical) return;
    // Low-confidence facts are stored but never trusted to invalidate an
    // existing fact — they skip contradiction judging entirely.
    if (c.confidence < settings.retrievalMinConfidence) return;
    const newValidAt = effectiveValidAt(c.validFrom).toISOString();

    const judgedIds = new Set<string>();
    for (const f of survivorNeighbours[si] ?? []) {
      if (judgedIds.has(f.id)) continue;
      const samePredicateConflict =
        f.predicate === c.predicate && f.object !== c.object;
      const bandConflict =
        !samePredicateConflict &&
        f.similarity !== undefined &&
        inContradictionBand(f.similarity, settings);
      if (!samePredicateConflict && !bandConflict) continue;
      judgedIds.add(f.id);
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

  // Attach each verdict to the conflict it judged, so the two lists cannot be
  // read out of step.
  const verdicts = await resolveContradictions(pairs);
  const judged = conflictRefs.map((ref, k) => ({
    ...ref,
    verdict: verdicts[k] ?? 'neither',
  }));

  // A survivor superseded by ANY existing fact ('new') is discarded entirely,
  // including its own 'old' verdicts. Otherwise it could invalidate an old fact
  // and then never be inserted, vaporizing the knowledge.
  const supersededSurvivors = new Set(
    judged.filter((j) => j.verdict === 'new').map((j) => j.survivorIndex),
  );

  const invalidationsBySurvivor = new Map<number, string[]>();
  for (const { verdict, survivorIndex, oldId } of judged) {
    if (verdict !== 'old' || supersededSurvivors.has(survivorIndex)) continue;
    const list = invalidationsBySurvivor.get(survivorIndex) ?? [];
    list.push(oldId);
    invalidationsBySurvivor.set(survivorIndex, list);
  }

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
      sql`SELECT pg_advisory_xact_lock(hashtext(${`${dataset}:${projectId}`}))`,
    );

    // Race re-check: facts a concurrent job committed after our snapshot never
    // went through this batch's dedup and contradiction pass, so a staged
    // survivor that now collides with one is dropped rather than inserted
    // unjudged.
    //
    // Matching is on subject + predicate + anchor, not subject + predicate.
    // Extraction forces every subject to the literal "user", so a
    // subject+predicate key is really just the predicate — and two genuinely
    // different facts that share one ("user likes thai food", "user likes
    // rust") would have silently discarded each other.
    const appeared = await tx
      .select({
        subject: facts.subject,
        predicate: facts.predicate,
        object: facts.object,
        objectIsEntity: facts.objectIsEntity,
      })
      .from(facts)
      .where(and(tenant, isLiveFact, gt(facts.createdAt, snapshotAt)));

    const appearedExact = new Set(
      appeared.map((f) => factKey(f.subject, f.predicate, f.object)),
    );
    const appearedAnchored = new Set(
      appeared.map((f) => `${f.subject}|${f.predicate}|${anchorFor(f)}`),
    );
    const finalStaged = staged.filter(
      ({ c }) =>
        !appearedExact.has(factKey(c.subject, c.predicate, c.object)) &&
        !appearedAnchored.has(`${c.subject}|${c.predicate}|${anchorFor(c)}`),
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
      dataset,
      projectId,
      subject: c.subject,
      predicate: c.predicate,
      object: c.object,
      objectIsEntity: c.objectIsEntity,
      confidence: c.confidence,
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
  confidence: facts.confidence,
  sourceQuote: facts.sourceQuote,
  validAt: facts.validAt,
  validUntil: facts.validUntil,
  invalidAt: facts.invalidAt,
  episodeId: facts.episodeId,
} as const;

/** Exactly the row shape {@link FACT_COLUMNS} selects — derived, not restated. */
type FactSelect = Pick<FactRow, keyof typeof FACT_COLUMNS>;

function rowToSemanticFact(r: FactSelect, relevanceScore?: number): SemanticFact {
  return {
    factId: r.id,
    subject: r.subject,
    predicate: r.predicate,
    object: r.object,
    objectIsEntity: r.objectIsEntity,
    confidence: r.confidence,
    sourceQuote: r.sourceQuote,
    validAt: r.validAt.toISOString(),
    validUntil: r.validUntil ? r.validUntil.toISOString() : null,
    invalidAt: r.invalidAt ? r.invalidAt.toISOString() : null,
    episodeId: r.episodeId,
    ...(relevanceScore !== undefined ? { relevanceScore } : {}),
  };
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
export interface SemanticRetrievalOptions {
  /** Confidence floor: facts below this are excluded from retrieval. */
  minConfidence: number;
  /** Min query↔entity embedding similarity for an entity to anchor retrieval. */
  anchorVectorMin: number;
  /** How many vector-matched anchor entities to admit. */
  anchorVectorTopK: number;
}

export async function getSemanticContext(
  dataset: string,
  projectId: string,
  query: string | undefined,
  limit: number,
  queryEmbedding: number[] | null | undefined,
  opts: SemanticRetrievalOptions,
): Promise<SemanticContext> {
  const tenant = and(
    eq(facts.dataset, dataset),
    eq(facts.projectId, projectId),
    isLiveFact,
    gte(facts.confidence, opts.minConfidence),
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
      .limit(limit));
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
      .limit(scan));
  };

  // Signal 2 — entity-anchored: resolve entities the query mentions (word-boundary
  // match, so "art" can't fire inside "start") plus the query's nearest entities
  // by embedding, then pull every live fact touching those names.
  const anchorSignal = async (): Promise<FactSelect[]> => {
    const entityTenant = and(
      eq(entities.dataset, dataset),
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
                sql`1 - (${entities.embedding} <=> ${toVectorLiteral(queryEmbedding)}::vector) >= ${opts.anchorVectorMin}`,
              ),
            )
            .orderBy(
              sql`${entities.embedding} <=> ${toVectorLiteral(queryEmbedding)}::vector`,
            )
            .limit(opts.anchorVectorTopK)
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
      .limit(scan));
  };

  // Signal 3 — keyword / full-text.
  const keywordSignal = async (): Promise<FactSelect[]> => {
    const tsquery = sql`plainto_tsquery('english', ${query})`;
    return (await db
      .select(FACT_COLUMNS)
      .from(facts)
      .where(and(tenant, sql`${factsTsv} @@ ${tsquery}`))
      .orderBy(sql`ts_rank(${factsTsv}, ${tsquery}) DESC`)
      .limit(scan));
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

/** Fetch entity records for a set of names (for the ENTITIES render section). */
export async function getEntitiesByName(
  dataset: string,
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
        eq(entities.dataset, dataset),
        eq(entities.projectId, projectId),
        inArray(entities.name, wanted),
      ),
    );
  return rows.map((r) => ({
    entityId: r.id,
    name: r.name,
    type: r.type,
  }));
}

// ── Dashboard / SDK read APIs ────────────────────────────────────────────────

export async function querySemanticFacts(
  dataset: string,
  projectId: string,
  opts: {
    q?: string;
    limit?: number;
    includeInvalidated?: boolean;
    /** Point-in-time filter: facts that were true at this instant. Overrides includeInvalidated. */
    asOf?: Date;
    /** Confidence floor; omit (dashboard) to include every stored fact. */
    minConfidence?: number;
    /** Provenance filter: only facts extracted from this episode. */
    episodeId?: string;
  } = {},
): Promise<{ facts: SemanticFact[]; total: number }> {
  const limit = opts.limit ?? 50;
  const conds = [eq(facts.dataset, dataset), eq(facts.projectId, projectId)];
  if (opts.asOf) conds.push(isLiveFactAsOf(opts.asOf));
  else if (!opts.includeInvalidated) conds.push(isLiveFact);
  if (opts.episodeId) conds.push(eq(facts.episodeId, opts.episodeId));
  if (opts.minConfidence !== undefined)
    conds.push(gte(facts.confidence, opts.minConfidence));
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
      .limit(limit),
    db.select({ count: count() }).from(facts).where(where),
  ]);
  return {
    facts: rows.map((r) => rowToSemanticFact(r)),
    total: totalRow?.count ?? rows.length,
  };
}

export async function listEntities(
  dataset: string,
  projectId: string,
): Promise<SemanticEntity[]> {
  const rows = await db
    .select({ id: entities.id, name: entities.name, type: entities.type })
    .from(entities)
    .where(and(eq(entities.dataset, dataset), eq(entities.projectId, projectId)))
    .orderBy(desc(entities.updatedAt));
  return rows.map((r) => ({
    entityId: r.id,
    name: r.name,
    type: r.type,
  }));
}

export async function listEntityFacts(
  dataset: string,
  projectId: string,
  name: string,
): Promise<SemanticFact[]> {
  const rows = (await db
    .select(FACT_COLUMNS)
    .from(facts)
    .where(
      and(
        eq(facts.dataset, dataset),
        eq(facts.projectId, projectId),
        isLiveFact,
        or(eq(facts.subject, name), eq(facts.object, name)),
      ),
    )
    .orderBy(desc(facts.validAt)));
  return rows.map((r) => rowToSemanticFact(r));
}

/** Soft-delete a fact by stamping invalidAt. Returns false if not found. */
export async function softDeleteFact(
  dataset: string,
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
        eq(facts.dataset, dataset),
        eq(facts.projectId, projectId),
        isNull(facts.invalidAt),
      ),
    )
    .returning({ id: facts.id });
  return updated.length > 0;
}

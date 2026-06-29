import { and, eq, isNull, isNotNull, or, desc, sql, inArray } from 'drizzle-orm';
import { db } from '../db/postgres.js';
import { episodes, facts, entities, messages, projects, threads } from '../db/schema.js';
import type { NewFactRow } from '../db/schema.js';
import { batchEmbedTexts } from '../lib/gemini.js';
import {
  extractGraph,
  resolveContradiction,
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

// ── Settings ──────────────────────────────────────────────────────────────────

/** Effective semantic settings: project defaults overlaid with any per-thread override. */
export async function getEffectiveSemanticSettings(
  projectId: string,
  threadId?: string | null,
): Promise<ProjectSemanticSettings> {
  const [projRow] = await db
    .select({ settings: projects.settings })
    .from(projects)
    .where(eq(projects.id, projectId));
  const base = mergeWithDefaults(
    projRow?.settings as ProjectSettingsPatch | null,
  ).semantic;

  if (!threadId) return base;
  const [tRow] = await db
    .select({ semanticSettings: threads.semanticSettings })
    .from(threads)
    .where(eq(threads.id, threadId));
  const override = tRow?.semanticSettings as Partial<ProjectSemanticSettings> | null;
  return override ? { ...base, ...override } : base;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Enriched embedding string for a fact. Appending the context entity makes the
 * subject more prominent in vector space, improving entity-centric retrieval.
 */
export function buildFactEmbedString(f: {
  subject: string;
  predicate: string;
  object: string;
  contextEntityName: string | null;
}): string {
  const base = `${f.subject} ${f.predicate} ${f.object}.`;
  return f.contextEntityName ? `${base} About: ${f.contextEntityName}.` : base;
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

// ── Pipeline entry point ────────────────────────────────────────────────────────
//
// Five steps: extract → resolve entities → dedup → evolve (contradictions) → write.
// Runs async off an episode reaching `completed`, on the episode's raw messages.

export async function processSemanticMemory(episodeId: string): Promise<void> {
  const now = new Date();

  // Atomic claim: only one worker moves pending/failed → processing.
  const [episode] = await db
    .update(episodes)
    .set({ semanticStatus: 'processing', updatedAt: now })
    .where(
      and(
        eq(episodes.id, episodeId),
        inArray(episodes.semanticStatus, ['pending', 'failed']),
      ),
    )
    .returning();
  if (!episode) return;

  try {
    const settings = await getEffectiveSemanticSettings(
      episode.projectId,
      episode.threadId,
    );
    if (!settings.enabled) {
      await db
        .update(episodes)
        .set({ semanticStatus: 'skipped', updatedAt: new Date() })
        .where(eq(episodes.id, episodeId));
      return;
    }

    // Raw messages in the episode's thread — direct signal beats the lossy summary.
    const msgRows = episode.threadId
      ? await db
          .select({ role: messages.role, content: messages.content })
          .from(messages)
          .where(
            and(
              eq(messages.threadId, episode.threadId),
              isNull(messages.compactedAt),
            ),
          )
          .orderBy(sql`${messages.sequenceNumber} ASC`)
      : [];

    if (msgRows.length === 0) {
      await db
        .update(episodes)
        .set({ semanticStatus: 'completed', updatedAt: new Date() })
        .where(eq(episodes.id, episodeId));
      return;
    }

    const transcript = msgRows.map((m) => `${m.role}: ${m.content}`).join('\n');

    // Step 1 — extract
    const graph = await extractGraph(transcript, settings.minConfidence);

    // Step 2 — resolve entities (dedup the entities table)
    await resolveEntities(episode.userId, episode.projectId, graph.entities, settings);

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
    );

    await db
      .update(episodes)
      .set({ semanticStatus: 'completed', updatedAt: new Date() })
      .where(eq(episodes.id, episodeId));
  } catch (err) {
    console.error('[semantic] processSemanticMemory failed:', episodeId, err);
    await db
      .update(episodes)
      .set({ semanticStatus: 'failed', updatedAt: new Date() })
      .where(eq(episodes.id, episodeId));
  }
}

// ── Step 2: entity resolution ───────────────────────────────────────────────────

async function resolveEntities(
  userId: string,
  projectId: string,
  extracted: ExtractedEntity[],
  settings: ProjectSemanticSettings,
): Promise<void> {
  if (extracted.length === 0) return;

  const existing = await db
    .select({
      id: entities.id,
      name: entities.name,
      embedding: entities.embedding,
    })
    .from(entities)
    .where(and(eq(entities.userId, userId), eq(entities.projectId, projectId)));

  const newEmbeds = await batchEmbedTexts(extracted.map((e) => e.name));

  for (let i = 0; i < extracted.length; i++) {
    const ent = extracted[i];
    const emb = newEmbeds[i];

    // Exact name match → refresh attributes.
    const exact = existing.find((x) => x.name === ent.name);
    if (exact) {
      await db
        .update(entities)
        .set({ attributes: ent.attributes, updatedAt: new Date() })
        .where(eq(entities.id, exact.id));
      continue;
    }

    // Nearest existing entity by embedding.
    let best: { id: string; score: number } | null = null;
    for (const x of existing) {
      if (!x.embedding) continue;
      const score = cosine(emb, x.embedding as number[]);
      if (!best || score > best.score) best = { id: x.id, score };
    }

    if (best && best.score >= settings.entityResolutionThreshold) {
      await db
        .update(entities)
        .set({ attributes: ent.attributes, updatedAt: new Date() })
        .where(eq(entities.id, best.id));
    } else {
      const [inserted] = await db
        .insert(entities)
        .values({
          userId,
          projectId,
          name: ent.name,
          type: ent.type,
          attributes: ent.attributes,
          embedding: emb,
        })
        .returning({ id: entities.id });
      existing.push({ id: inserted.id, name: ent.name, embedding: emb });
    }
  }
}

// ── Steps 3–5: dedup, evolve, write ─────────────────────────────────────────────

interface FactCandidate {
  subject: string;
  predicate: string;
  object: string;
  objectIsEntity: boolean;
  confidence: number;
}

async function writeFacts(
  ctx: { userId: string; projectId: string; episodeId: string },
  graph: ExtractedGraph,
  settings: ProjectSemanticSettings,
  now: Date,
): Promise<void> {
  const { userId, projectId, episodeId } = ctx;

  // Literal facts + relationships flow into the same table.
  const candidates: FactCandidate[] = [
    ...graph.literalFacts.map((f) => ({
      subject: f.subject,
      predicate: f.predicate,
      object: f.value,
      objectIsEntity: false,
      confidence: f.confidence,
    })),
    ...graph.relationships.map((r) => ({
      subject: r.subject,
      predicate: r.predicate,
      object: r.object,
      objectIsEntity: true,
      confidence: r.confidence,
    })),
  ];
  if (candidates.length === 0) return;

  // Existing live facts for this tenant (the dedup/contradiction baseline).
  const live = await db
    .select({
      id: facts.id,
      subject: facts.subject,
      predicate: facts.predicate,
      object: facts.object,
      validAt: facts.validAt,
      embedding: facts.embedding,
    })
    .from(facts)
    .where(
      and(
        eq(facts.userId, userId),
        eq(facts.projectId, projectId),
        isNull(facts.invalidAt),
      ),
    );

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

  // Embed candidates (enriched). contextEntityName doubles as the subject anchor.
  const embeds = await batchEmbedTexts(
    deduped.map((c) =>
      buildFactEmbedString({ ...c, contextEntityName: c.subject }),
    ),
  );

  const invalidated = new Set<string>();
  const toInsert: NewFactRow[] = [];

  for (let i = 0; i < deduped.length; i++) {
    const c = deduped[i];
    const emb = embeds[i];

    // Step 3b — near-duplicate by embedding similarity.
    let isDup = false;
    for (const f of live) {
      if (invalidated.has(f.id) || !f.embedding) continue;
      if (cosine(emb, f.embedding as number[]) >= settings.factDedupThreshold) {
        isDup = true;
        break;
      }
    }
    if (isDup) continue;

    // Step 4 — contradiction: same subject+predicate, different object.
    const conflicts = live.filter(
      (f) =>
        !invalidated.has(f.id) &&
        f.subject === c.subject &&
        f.predicate === c.predicate &&
        f.object !== c.object,
    );
    let supersededByOld = false;
    for (const old of conflicts) {
      const verdict = await resolveContradiction(
        c.subject,
        c.predicate,
        old.object,
        old.validAt.toISOString(),
        c.object,
        now.toISOString(),
      );
      if (verdict === 'old') {
        await db
          .update(facts)
          .set({ invalidAt: now, updatedAt: now })
          .where(eq(facts.id, old.id));
        invalidated.add(old.id);
      } else if (verdict === 'new') {
        // Existing fact still correct — skip inserting the new one.
        supersededByOld = true;
      }
      // 'neither' — both coexist.
    }
    if (supersededByOld) continue;

    // Step 5 — stage for insert.
    toInsert.push({
      userId,
      projectId,
      subject: c.subject,
      predicate: c.predicate,
      object: c.object,
      objectIsEntity: c.objectIsEntity,
      contextEntityName: c.subject,
      confidence: c.confidence,
      episodeId,
      validAt: now,
      ingestionAt: now,
      embedding: emb,
    });
  }

  if (toInsert.length > 0) {
    await db.insert(facts).values(toInsert);
  }
}

// ── Retry job ───────────────────────────────────────────────────────────────────

/** Re-runs semantic extraction for episodes left in `failed`. */
export async function retryFailedSemanticMemory(): Promise<void> {
  const rows = await db
    .select({ id: episodes.id })
    .from(episodes)
    .where(eq(episodes.semanticStatus, 'failed'))
    .limit(20);
  for (const row of rows) {
    processSemanticMemory(row.id).catch((err) => {
      console.error('[semantic] retry failed:', row.id, err);
    });
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
  contextEntityName: facts.contextEntityName,
  validAt: facts.validAt,
  ingestionAt: facts.ingestionAt,
  invalidAt: facts.invalidAt,
  episodeId: facts.episodeId,
} as const;

type FactSelect = {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  objectIsEntity: boolean;
  confidence: number;
  contextEntityName: string | null;
  validAt: Date;
  ingestionAt: Date;
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
    confidence: r.confidence,
    contextEntityName: r.contextEntityName,
    validAt: r.validAt.toISOString(),
    ingestionAt: r.ingestionAt.toISOString(),
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
    isNull(facts.invalidAt),
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

  const lists: string[][] = [];

  // Signal 1 — vector similarity.
  if (queryEmbedding && queryEmbedding.length > 0) {
    const vectorLiteral = `[${queryEmbedding.join(',')}]`;
    const rows = (await db
      .select(FACT_COLUMNS)
      .from(facts)
      .where(and(tenant, isNotNull(facts.embedding)))
      .orderBy(sql`${facts.embedding} <=> ${vectorLiteral}::vector`)
      .limit(scan)) as FactSelect[];
    record(rows);
    lists.push(rows.map((r) => r.id));
  }

  // Signal 2 — entity-anchored lookup. Resolve entities whose name appears in the
  // query, then pull every live fact anchored to those names.
  const anchorRows = await db
    .select({ name: entities.name })
    .from(entities)
    .where(
      and(
        eq(entities.userId, userId),
        eq(entities.projectId, projectId),
        sql`position(lower(${entities.name}) in lower(${query})) > 0`,
      ),
    );
  const anchors = anchorRows.map((r) => r.name);
  if (anchors.length > 0) {
    const rows = (await db
      .select(FACT_COLUMNS)
      .from(facts)
      .where(
        and(
          tenant,
          or(
            inArray(facts.subject, anchors),
            inArray(facts.object, anchors),
            inArray(facts.contextEntityName, anchors),
          ),
        ),
      )
      .limit(scan)) as FactSelect[];
    record(rows);
    lists.push(rows.map((r) => r.id));
  }

  // Signal 3 — keyword / full-text. Expression matches the facts_tsv_idx index.
  const tsv = sql`to_tsvector('english', coalesce(${facts.subject}, '') || ' ' || coalesce(${facts.predicate}, '') || ' ' || coalesce(${facts.object}, '') || ' ' || coalesce(${facts.contextEntityName}, ''))`;
  const tsquery = sql`plainto_tsquery('english', ${query})`;
  const kwRows = (await db
    .select(FACT_COLUMNS)
    .from(facts)
    .where(and(tenant, sql`${tsv} @@ ${tsquery}`))
    .orderBy(sql`ts_rank(${tsv}, ${tsquery}) DESC`)
    .limit(scan)) as FactSelect[];
  record(kwRows);
  lists.push(kwRows.map((r) => r.id));

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

/** Group facts by contextEntityName (anchor), sorted by relevance. */
export function assembleContext(factList: SemanticFact[]): RankedContextGroup[] {
  const groupMap = new Map<string, RankedContextGroup>();
  for (const fact of factList) {
    const key = fact.contextEntityName ?? '__global';
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
      confidence: fact.confidence,
      validAt: fact.validAt,
      invalidAt: fact.invalidAt,
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
      const until = f.invalidAt ? formatDate(f.invalidAt) : 'present';
      lines.push(
        `- ${f.subject} ${f.predicate} ${f.object}  (valid: ${formatDate(f.validAt)} – ${until})`,
      );
    }
  }

  const named = entityList.filter((e) => e.name !== '__global');
  if (named.length > 0) {
    lines.push('', '# ENTITIES');
    for (const e of named) {
      const attrs = Object.entries(e.attributes ?? {})
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
        .join('; ');
      lines.push(`- ${e.name} (${e.type})${attrs ? `: ${attrs}` : ''}`);
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
  const wanted = names.filter((n) => n && n !== '__global');
  if (wanted.length === 0) return [];
  const rows = await db
    .select({
      id: entities.id,
      name: entities.name,
      type: entities.type,
      attributes: entities.attributes,
      factCount: entities.factCount,
    })
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
    attributes: (r.attributes as Record<string, unknown>) ?? {},
    factCount: r.factCount,
  }));
}

// ── Dashboard / SDK read APIs ────────────────────────────────────────────────

export async function querySemanticFacts(
  userId: string,
  projectId: string,
  opts: { q?: string; limit?: number; includeInvalidated?: boolean } = {},
): Promise<{ facts: SemanticFact[]; total: number }> {
  const limit = opts.limit ?? 50;
  const conds = [eq(facts.userId, userId), eq(facts.projectId, projectId)];
  if (!opts.includeInvalidated) conds.push(isNull(facts.invalidAt));
  if (opts.q && opts.q.trim().length > 0) {
    const tsv = sql`to_tsvector('english', coalesce(${facts.subject}, '') || ' ' || coalesce(${facts.predicate}, '') || ' ' || coalesce(${facts.object}, '') || ' ' || coalesce(${facts.contextEntityName}, ''))`;
    conds.push(sql`${tsv} @@ plainto_tsquery('english', ${opts.q})`);
  }
  const rows = (await db
    .select(FACT_COLUMNS)
    .from(facts)
    .where(and(...conds))
    .orderBy(desc(facts.validAt))
    .limit(limit)) as FactSelect[];
  return { facts: rows.map((r) => rowToSemanticFact(r)), total: rows.length };
}

export async function listEntities(
  userId: string,
  projectId: string,
): Promise<SemanticEntity[]> {
  const rows = await db
    .select({
      id: entities.id,
      name: entities.name,
      type: entities.type,
      attributes: entities.attributes,
      factCount: entities.factCount,
    })
    .from(entities)
    .where(and(eq(entities.userId, userId), eq(entities.projectId, projectId)))
    .orderBy(desc(entities.updatedAt));
  return rows.map((r) => ({
    entityId: r.id,
    name: r.name,
    type: r.type as SemanticEntity['type'],
    attributes: (r.attributes as Record<string, unknown>) ?? {},
    factCount: r.factCount,
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
        isNull(facts.invalidAt),
        or(
          eq(facts.subject, name),
          eq(facts.object, name),
          eq(facts.contextEntityName, name),
        ),
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

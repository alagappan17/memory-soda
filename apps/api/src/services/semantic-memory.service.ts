import { eq, and, inArray } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/postgres.js';
import { episodes, projects, threads } from '../db/schema.js';
import { mergeWithDefaults } from '../lib/project-settings.js';
import type { ProjectSemanticSettings } from '@memory-soda/types';
import neo4j from 'neo4j-driver';
import { neo4jDriver } from '../db/neo4j.js';
import { embedText } from '../lib/gemini.js';
import {
  extractGraph,
  resolveContradiction,
  type ExtractedEntity,
} from '../lib/semantic-extraction.js';
import type {
  SemanticContext,
  SemanticFact,
  SemanticEntity,
  SemanticRelationship,
} from '@memory-soda/types';

const PREFERRED_ANCHOR_TYPES = new Set(['PLACE', 'EVENT', 'TOPIC']);
const factKey = (s: string, p: string, o: string) => `${s}|${p}|${o}`;

async function getSemanticSettings(projectId: string): Promise<ProjectSemanticSettings> {
  const [row] = await db.select({ settings: projects.settings }).from(projects).where(eq(projects.id, projectId));
  return mergeWithDefaults(row?.settings as Parameters<typeof mergeWithDefaults>[0]).semantic;
}

// Per-thread semantic settings are frozen on the thread at creation; fall back to
// the project default for threads created before per-thread freezing.
async function getEffectiveSemanticSettings(
  projectId: string,
  threadId: string | null,
): Promise<ProjectSemanticSettings> {
  if (threadId) {
    const [row] = await db
      .select({ semanticSettings: threads.semanticSettings })
      .from(threads)
      .where(eq(threads.id, threadId));
    const frozen = row?.semanticSettings as ProjectSemanticSettings | null | undefined;
    if (frozen) return frozen;
  }
  return getSemanticSettings(projectId);
}

// ── Internal types ────────────────────────────────────────────────────────────

interface ResolvedEntity extends ExtractedEntity {
  canonicalName: string;
  isNew: boolean;
  embedding: number[];
}

interface NormalizedRelationship {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
}

interface NormalizedLiteralFact {
  factId: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  embedding: number[];
}

// ── Pipeline entry point ──────────────────────────────────────────────────────

export async function processSemanticMemory(episodeId: string): Promise<void> {
  const now = new Date();

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

  const summary = episode.summary;
  // Prefer structured userFacts (new episodes); fall back to keyLearnings for old ones
  const userFacts = (episode.userFacts as string[] | null) ?? (episode.keyLearnings as string[] | null);

  const semanticSettings = await getEffectiveSemanticSettings(
    episode.projectId,
    episode.threadId,
  );

  if (!semanticSettings.enabled) {
    await db
      .update(episodes)
      .set({ semanticStatus: 'skipped', updatedAt: new Date() })
      .where(eq(episodes.id, episodeId));
    return;
  }

  if (!summary || !userFacts || userFacts.length < semanticSettings.minUserFacts) {
    await db
      .update(episodes)
      .set({ semanticStatus: 'skipped', updatedAt: new Date() })
      .where(eq(episodes.id, episodeId));
    return;
  }

  const userId = episode.userId;
  const projectId = episode.projectId;
  const validAt = (episode.endedAt ?? episode.updatedAt).toISOString();
  const ingestionAt = new Date().toISOString();

  try {
    // ── Phase 1: Extract graph ────────────────────────────────────────────────
    const { entities, relationships, literalFacts } = await extractGraph(
      summary,
      userFacts,
      semanticSettings.minConfidence,
    );

    if (entities.length === 0) {
      await db
        .update(episodes)
        .set({ semanticStatus: 'skipped', updatedAt: new Date() })
        .where(eq(episodes.id, episodeId));
      return;
    }

    // ── Phase 2: Entity resolution ────────────────────────────────────────────
    const resolvedEntities = await resolveEntities(entities, userId, projectId, semanticSettings.entitySimilarityThreshold);
    const canonicalNames = new Map(resolvedEntities.map((e) => [e.name, e.canonicalName]));

    // Write new entities to graph
    await batchMergeEntities(resolvedEntities, userId, projectId);

    // ── Phase 3: Write entity-to-entity relationships ─────────────────────────
    const normalizedRels: NormalizedRelationship[] = relationships
      .map((r) => ({
        id: uuidv4(),
        subject: canonicalNames.get(r.subject) ?? r.subject,
        predicate: r.predicate,
        object: canonicalNames.get(r.object) ?? r.object,
        confidence: r.confidence,
      }))
      .filter((r) => r.subject !== r.object);

    if (normalizedRels.length > 0) {
      await batchMergeRelationships(normalizedRels, userId, projectId, episodeId, validAt);
      await detectRelationshipContradictions(normalizedRels, userId, projectId, validAt);
    }

    // Determine the primary entity this episode is about (e.g. "paris", "bhutan")
    const contextEntityName = findEpisodeAnchorEntity(resolvedEntities, normalizedRels);

    // ── Phase 4: Write literal facts ──────────────────────────────────────────
    const allLiterals = literalFacts.map((f) => ({
      subject: canonicalNames.get(f.subject) ?? f.subject,
      predicate: f.predicate,
      object: f.value,
      confidence: f.confidence,
    }));

    if (allLiterals.length > 0) {
      // Exact dedup first — avoids paying embedding cost for trivial duplicates
      const afterExact = await filterExactDuplicates(allLiterals, userId, projectId, contextEntityName);

      if (afterExact.length > 0) {
        const embeddings = await Promise.all(
          afterExact.map((f) => embedText(`${f.subject} ${f.predicate} ${f.object}`)),
        );
        const withEmbeddings = afterExact.map((f, i) => ({ ...f, embedding: embeddings[i]! }));

        const newLiterals = await filterSimilarFacts(withEmbeddings, userId, projectId, contextEntityName);

        if (newLiterals.length > 0) {
          const factsWithIds: NormalizedLiteralFact[] = newLiterals.map((f) => ({
            factId: uuidv4(),
            subject: f.subject,
            predicate: f.predicate,
            object: f.object,
            confidence: f.confidence,
            embedding: f.embedding,
          }));

          await batchWriteLiteralFacts(factsWithIds, userId, projectId, episodeId, validAt, ingestionAt, contextEntityName);
          await detectLiteralContradictions(factsWithIds, userId, projectId, validAt, contextEntityName);
        }
      }
    }

    await db
      .update(episodes)
      .set({ semanticStatus: 'completed', updatedAt: new Date() })
      .where(eq(episodes.id, episodeId));
  } catch (err) {
    await db
      .update(episodes)
      .set({
        semanticStatus: 'failed',
        error: err instanceof Error ? err.message : String(err),
        updatedAt: new Date(),
      })
      .where(eq(episodes.id, episodeId));
  }
}

// ── Episode anchor entity ─────────────────────────────────────────────────────

function findEpisodeAnchorEntity(
  resolvedEntities: ResolvedEntity[],
  normalizedRels: NormalizedRelationship[],
): string | null {
  const counts = new Map<string, number>();
  for (const rel of normalizedRels) {
    if (rel.subject === 'user') counts.set(rel.object, (counts.get(rel.object) ?? 0) + 1);
    else if (rel.object === 'user') counts.set(rel.subject, (counts.get(rel.subject) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  const typeMap = new Map(resolvedEntities.map((e) => [e.canonicalName, e.type]));
  let best: string | null = null;
  let bestScore = -1;
  for (const [name, count] of counts) {
    const score = (PREFERRED_ANCHOR_TYPES.has(typeMap.get(name) ?? '') ? 10 : 0) + count;
    if (score > bestScore) { bestScore = score; best = name; }
  }
  return best;
}

// ── Entity resolution ─────────────────────────────────────────────────────────

async function resolveEntities(
  entities: ExtractedEntity[],
  userId: string,
  projectId: string,
  similarityThreshold = 0.95,
): Promise<ResolvedEntity[]> {
  const session = neo4jDriver.session();
  let existingNames: Set<string>;
  try {
    const result = await session.run(
      `MATCH (e:Entity {userId: $userId, projectId: $projectId})
       RETURN e.name AS name, e.embedding AS embedding`,
      { userId, projectId },
    );
    existingNames = new Set(result.records.map((r) => r.get('name') as string));

    // Build existing entity embeddings for similarity check
    const existingEmbeddings: { name: string; embedding: number[] }[] = result.records
      .filter((r) => r.get('embedding') !== null)
      .map((r) => ({ name: r.get('name') as string, embedding: r.get('embedding') as number[] }));

    const resolved: ResolvedEntity[] = [];

    for (const entity of entities) {
      // 1. Exact match
      if (existingNames.has(entity.name)) {
        resolved.push({ ...entity, canonicalName: entity.name, isNew: false, embedding: [] });
        continue;
      }

      // 2. Embedding similarity match
      const embedding = await embedText(entity.name);
      const similar = findSimilarEntity(embedding, existingEmbeddings, similarityThreshold);
      if (similar) {
        resolved.push({ ...entity, canonicalName: similar, isNew: false, embedding });
        continue;
      }

      // 3. New entity
      resolved.push({ ...entity, canonicalName: entity.name, isNew: true, embedding });
    }

    return resolved;
  } finally {
    await session.close();
  }
}

function findSimilarEntity(
  embedding: number[],
  existing: { name: string; embedding: number[] }[],
  threshold: number,
): string | null {
  let bestName: string | null = null;
  let bestScore = threshold;

  for (const { name, embedding: existingEmb } of existing) {
    const score = cosineSimilarity(embedding, existingEmb);
    if (score > bestScore) {
      bestScore = score;
      bestName = name;
    }
  }

  return bestName;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Entity batch MERGE ────────────────────────────────────────────────────────

async function batchMergeEntities(
  entities: ResolvedEntity[],
  userId: string,
  projectId: string,
): Promise<void> {
  const newEntities = entities.filter((e) => e.isNew);
  if (newEntities.length === 0) return;

  const session = neo4jDriver.session();
  try {
    const now = new Date().toISOString();
    for (const e of newEntities) {
      await session.run(
        `MERGE (node:Entity {userId: $userId, projectId: $projectId, name: $name})
         ON CREATE SET node.id = $id, node.type = $type, node.embedding = $embedding, node.createdAt = $now
         ON MATCH SET node.type = CASE WHEN node.type IS NULL THEN $type ELSE node.type END
         SET node += $attributes`,
        {
          userId,
          projectId,
          name: e.canonicalName,
          id: uuidv4(),
          type: e.type,
          embedding: e.embedding.length > 0 ? e.embedding : null,
          attributes: e.attributes,
          now,
        },
      );
    }
  } finally {
    await session.close();
  }
}

// ── Relationship MERGE ────────────────────────────────────────────────────────

async function batchMergeRelationships(
  rels: NormalizedRelationship[],
  userId: string,
  projectId: string,
  episodeId: string,
  validAt: string,
): Promise<void> {
  const session = neo4jDriver.session();
  try {
    for (const r of rels) {
      await session.run(
        `MATCH (s:Entity {userId: $userId, projectId: $projectId, name: $subject})
         MATCH (o:Entity {userId: $userId, projectId: $projectId, name: $object})
         MERGE (s)-[edge:RELATED_TO {userId: $userId, projectId: $projectId, type: $predicate}]->(o)
         ON CREATE SET
           edge.id = $id,
           edge.confidence = $confidence,
           edge.validAt = $validAt,
           edge.episodeId = $episodeId,
           edge.invalidAt = null
         ON MATCH SET
           edge.confidence = $confidence,
           edge.episodeId = $episodeId`,
        {
          userId,
          projectId,
          subject: r.subject,
          object: r.object,
          predicate: r.predicate,
          id: r.id,
          confidence: r.confidence,
          validAt,
          episodeId,
        },
      );
    }
  } finally {
    await session.close();
  }
}

// ── Literal fact dedup filters ────────────────────────────────────────────────

async function filterExactDuplicates(
  facts: { subject: string; predicate: string; object: string; confidence: number }[],
  userId: string,
  projectId: string,
  contextEntityName: string | null,
): Promise<typeof facts> {
  const session = neo4jDriver.session();
  try {
    const result = await session.run(
      `UNWIND $facts AS f
       MATCH (s:Entity {userId: $userId, projectId: $projectId, name: f.subject})-[:HAS_FACT]->(existing:MemoryFact)
       WHERE existing.predicate = f.predicate
         AND existing.object = f.object
         AND existing.invalidAt IS NULL
         AND (
           ($contextEntityName IS NULL AND existing.contextEntityName IS NULL)
           OR existing.contextEntityName = $contextEntityName
         )
       RETURN f.subject AS subject, f.predicate AS predicate, f.object AS object`,
      {
        facts: facts.map((f) => ({ subject: f.subject, predicate: f.predicate, object: f.object })),
        userId,
        projectId,
        contextEntityName,
      },
    );

    const duplicateKeys = new Set(
      result.records.map((r) => factKey(r.get('subject') as string, r.get('predicate') as string, r.get('object') as string)),
    );
    return facts.filter((f) => !duplicateKeys.has(factKey(f.subject, f.predicate, f.object)));
  } finally {
    await session.close();
  }
}

async function filterSimilarFacts(
  facts: { subject: string; predicate: string; object: string; confidence: number; embedding: number[] }[],
  userId: string,
  projectId: string,
  contextEntityName: string | null,
  similarityThreshold = 0.90,
): Promise<typeof facts> {
  const session = neo4jDriver.session();
  try {
    const duplicateKeys = new Set<string>();

    for (const f of facts) {
      const result = await session.run(
        `CALL db.index.vector.queryNodes('memory_facts_embedding', 20, $embedding)
         YIELD node AS existing, score
         WHERE existing.userId = $userId AND existing.projectId = $projectId
           AND existing.subject = $subject
           AND existing.invalidAt IS NULL
           AND (
             ($contextEntityName IS NULL AND existing.contextEntityName IS NULL)
             OR existing.contextEntityName = $contextEntityName
           )
         RETURN score ORDER BY score DESC LIMIT 1`,
        { userId, projectId, subject: f.subject, embedding: f.embedding, contextEntityName },
      );

      const topScore = result.records[0]?.get('score') as number | undefined;
      if (topScore !== undefined && topScore >= similarityThreshold) {
        duplicateKeys.add(factKey(f.subject, f.predicate, f.object));
      }
    }

    return facts.filter((f) => !duplicateKeys.has(factKey(f.subject, f.predicate, f.object)));
  } finally {
    await session.close();
  }
}

// ── Literal fact batch write ──────────────────────────────────────────────────

async function batchWriteLiteralFacts(
  facts: NormalizedLiteralFact[],
  userId: string,
  projectId: string,
  episodeId: string,
  validAt: string,
  ingestionAt: string,
  contextEntityName: string | null,
): Promise<void> {
  const session = neo4jDriver.session();
  try {
    await session.run(
      `UNWIND $facts AS f
       MATCH (s:Entity {userId: $userId, projectId: $projectId, name: f.subject})
       CREATE (fact:MemoryFact {
         id: f.factId,
         subject: f.subject,
         predicate: f.predicate,
         object: f.object,
         objectIsEntity: false,
         confidence: f.confidence,
         userId: $userId,
         projectId: $projectId,
         episodeId: $episodeId,
         validAt: $validAt,
         ingestionAt: $ingestionAt,
         invalidAt: null,
         embedding: f.embedding,
         contextEntityName: $contextEntityName
       })
       CREATE (s)-[:HAS_FACT]->(fact)`,
      { facts, userId, projectId, episodeId, validAt, ingestionAt, contextEntityName },
    );
  } finally {
    await session.close();
  }
}

// ── Contradiction detection ───────────────────────────────────────────────────

async function detectRelationshipContradictions(
  rels: NormalizedRelationship[],
  userId: string,
  projectId: string,
  newValidAt: string,
): Promise<void> {
  const session = neo4jDriver.session();
  let conflicts: {
    newRelId: string;
    subject: string;
    predicate: string;
    newObject: string;
    conflictId: string;
    conflictObject: string;
    conflictValidAt: string;
  }[] = [];

  try {
    const result = await session.run(
      `UNWIND $rels AS r
       MATCH (s:Entity {userId: $userId, projectId: $projectId, name: r.subject})
         -[existing:RELATED_TO {userId: $userId, projectId: $projectId, type: r.predicate}]->
         (o:Entity)
       WHERE o.name <> r.object
         AND existing.invalidAt IS NULL
         AND existing.id <> r.id
       RETURN r.id AS newRelId, r.subject AS subject, r.predicate AS predicate,
              r.object AS newObject,
              existing.id AS conflictId, o.name AS conflictObject,
              existing.validAt AS conflictValidAt`,
      {
        rels: rels.map((r) => ({ id: r.id, subject: r.subject, predicate: r.predicate, object: r.object })),
        userId,
        projectId,
      },
    );

    conflicts = result.records.map((r) => ({
      newRelId: r.get('newRelId') as string,
      subject: r.get('subject') as string,
      predicate: r.get('predicate') as string,
      newObject: r.get('newObject') as string,
      conflictId: r.get('conflictId') as string,
      conflictObject: r.get('conflictObject') as string,
      conflictValidAt: r.get('conflictValidAt') as string,
    }));
  } finally {
    await session.close();
  }

  await Promise.all(
    conflicts.map(async (conflict) => {
      const verdict = await resolveContradiction(
        conflict.subject,
        conflict.predicate,
        conflict.conflictObject,
        conflict.conflictValidAt,
        conflict.newObject,
        newValidAt,
      );
      if (verdict === 'old') await invalidateRelationship(conflict.conflictId, userId, projectId);
      else if (verdict === 'new') await invalidateRelationship(conflict.newRelId, userId, projectId);
    }),
  );
}

async function detectLiteralContradictions(
  facts: NormalizedLiteralFact[],
  userId: string,
  projectId: string,
  newValidAt: string,
  contextEntityName: string | null,
): Promise<void> {
  const session = neo4jDriver.session();
  let conflicts: {
    newFactId: string;
    subject: string;
    predicate: string;
    newObject: string;
    conflictId: string;
    conflictObject: string;
    conflictValidAt: string;
  }[] = [];

  try {
    const result = await session.run(
      `UNWIND $facts AS f
       MATCH (s:Entity {userId: $userId, projectId: $projectId, name: f.subject})-[:HAS_FACT]->(existing:MemoryFact)
       WHERE existing.predicate = f.predicate
         AND existing.object <> f.object
         AND existing.invalidAt IS NULL
         AND existing.id <> f.factId
         AND (
           ($contextEntityName IS NULL AND existing.contextEntityName IS NULL)
           OR existing.contextEntityName = $contextEntityName
         )
       RETURN f.factId AS newFactId, f.subject AS subject, f.predicate AS predicate,
              f.object AS newObject,
              existing.id AS conflictId, existing.object AS conflictObject,
              existing.validAt AS conflictValidAt`,
      {
        facts: facts.map((f) => ({ factId: f.factId, subject: f.subject, predicate: f.predicate, object: f.object })),
        userId,
        projectId,
        contextEntityName,
      },
    );

    conflicts = result.records.map((r) => ({
      newFactId: r.get('newFactId') as string,
      subject: r.get('subject') as string,
      predicate: r.get('predicate') as string,
      newObject: r.get('newObject') as string,
      conflictId: r.get('conflictId') as string,
      conflictObject: r.get('conflictObject') as string,
      conflictValidAt: r.get('conflictValidAt') as string,
    }));
  } finally {
    await session.close();
  }

  await Promise.all(
    conflicts.map(async (conflict) => {
      const verdict = await resolveContradiction(
        conflict.subject,
        conflict.predicate,
        conflict.conflictObject,
        conflict.conflictValidAt,
        conflict.newObject,
        newValidAt,
      );
      if (verdict === 'old') await invalidateFact(conflict.conflictId);
      else if (verdict === 'new') await invalidateFact(conflict.newFactId);
    }),
  );
}

async function invalidateRelationship(relId: string, userId: string, projectId: string): Promise<void> {
  const session = neo4jDriver.session();
  try {
    await session.run(
      `MATCH ()-[r:RELATED_TO {id: $relId, userId: $userId, projectId: $projectId}]->()
       SET r.invalidAt = $now`,
      { relId, userId, projectId, now: new Date().toISOString() },
    );
  } finally {
    await session.close();
  }
}

async function invalidateFact(factId: string): Promise<void> {
  const session = neo4jDriver.session();
  try {
    await session.run(
      `MATCH (f:MemoryFact {id: $factId}) SET f.invalidAt = $now`,
      { factId, now: new Date().toISOString() },
    );
  } finally {
    await session.close();
  }
}

// ── Retrieval ─────────────────────────────────────────────────────────────────

export async function getSemanticContext(
  userId: string,
  projectId: string,
  query: string | undefined,
  limit = 5,
): Promise<SemanticContext> {
  const neoLimit = neo4j.int(limit);
  const session = neo4jDriver.session();
  try {
    let literalFacts: SemanticFact[] = [];
    let anchorEntityNames: string[] = [];

    if (query) {
      const queryEmbedding = await embedText(query);
      // Overscan: retrieve many more candidates than needed so the per-user
      // post-filter has enough to work with when the index is shared across users.
      const scanLimit = neo4j.int(Math.max(limit * 20, 50));
      const factResult = await session.run(
        `CALL db.index.vector.queryNodes('memory_facts_embedding', $scanLimit, $embedding)
         YIELD node AS f, score
         WHERE f.userId = $userId AND f.projectId = $projectId AND f.invalidAt IS NULL
         RETURN f.id AS factId, f.subject AS subject, f.predicate AS predicate,
                f.object AS object, f.confidence AS confidence, f.validAt AS validAt,
                f.episodeId AS episodeId, f.ingestionAt AS ingestionAt,
                f.contextEntityName AS contextEntityName, score
         ORDER BY score DESC
         LIMIT $limit`,
        { userId, projectId, embedding: queryEmbedding, limit: neoLimit, scanLimit },
      );
      literalFacts = factResult.records.map((r) => recordToFact(r, userId, projectId, r.get('score') as number));
      anchorEntityNames = [...new Set(literalFacts.map((f) => f.subject))];
    } else {
      const factResult = await session.run(
        `MATCH (f:MemoryFact {userId: $userId, projectId: $projectId})
         WHERE f.invalidAt IS NULL
         RETURN f.id AS factId, f.subject AS subject, f.predicate AS predicate,
                f.object AS object, f.confidence AS confidence, f.validAt AS validAt,
                f.episodeId AS episodeId, f.ingestionAt AS ingestionAt,
                f.contextEntityName AS contextEntityName
         ORDER BY f.validAt DESC
         LIMIT $limit`,
        { userId, projectId, limit: neoLimit },
      );
      literalFacts = factResult.records.map((r) => recordToFact(r, userId, projectId, 1.0));
      anchorEntityNames = [...new Set(literalFacts.map((f) => f.subject))];
    }

    // K-hop expansion: fetch RELATED_TO edges from anchor entities
    let relationships: SemanticRelationship[] = [];
    if (anchorEntityNames.length > 0) {
      const relResult = await session.run(
        `MATCH (s:Entity {userId: $userId, projectId: $projectId})-[r:RELATED_TO {userId: $userId, projectId: $projectId}]->(o:Entity)
         WHERE s.name IN $anchorNames AND r.invalidAt IS NULL
         RETURN r.id AS id, s.name AS subject, r.type AS predicate, o.name AS object,
                r.confidence AS confidence, r.validAt AS validAt,
                r.episodeId AS episodeId, r.invalidAt AS invalidAt
         LIMIT $relLimit`,
        { userId, projectId, anchorNames: anchorEntityNames, relLimit: neo4j.int(limit * 3) },
      );
      relationships = relResult.records.map((r) => ({
        id: r.get('id') as string,
        subject: r.get('subject') as string,
        predicate: r.get('predicate') as string,
        object: r.get('object') as string,
        confidence: r.get('confidence') as number,
        userId,
        projectId,
        episodeId: (r.get('episodeId') as string | null) ?? null,
        validAt: r.get('validAt') as string,
        invalidAt: (r.get('invalidAt') as string | null) ?? null,
      }));
    }

    return {
      facts: literalFacts,
      factCount: literalFacts.length,
      relationships,
      relationshipCount: relationships.length,
    };
  } catch (err) {
    console.error('[semantic] getSemanticContext failed:', err);
    return { facts: [], factCount: 0, relationships: [], relationshipCount: 0 };
  } finally {
    await session.close();
  }
}

// ── REST helpers ──────────────────────────────────────────────────────────────

export async function querySemanticFacts(
  userId: string,
  projectId: string,
  query: string | undefined,
  limit: number,
  includeInvalidated: boolean,
): Promise<{ facts: SemanticFact[]; total: number }> {
  const neoLimit = neo4j.int(limit);
  const session = neo4jDriver.session();
  try {
    const invalidFilter = includeInvalidated ? '' : 'AND f.invalidAt IS NULL';

    if (query) {
      const queryEmbedding = await embedText(query);
      const scanLimit = neo4j.int(Math.max(limit * 20, 50));
      const result = await session.run(
        `CALL db.index.vector.queryNodes('memory_facts_embedding', $scanLimit, $embedding)
         YIELD node AS f, score
         WHERE f.userId = $userId AND f.projectId = $projectId ${invalidFilter}
         RETURN f.id AS factId, f.subject AS subject, f.predicate AS predicate,
                f.object AS object, f.objectIsEntity AS objectIsEntity,
                f.confidence AS confidence, f.episodeId AS episodeId,
                f.validAt AS validAt, f.ingestionAt AS ingestionAt,
                f.invalidAt AS invalidAt, f.contextEntityName AS contextEntityName, score
         ORDER BY score DESC
         LIMIT $limit`,
        { userId, projectId, embedding: queryEmbedding, limit: neoLimit, scanLimit },
      );
      const facts = result.records.map((r) => recordToFact(r, userId, projectId, r.get('score') as number));
      return { facts, total: facts.length };
    }

    const countResult = await session.run(
      `MATCH (f:MemoryFact {userId: $userId, projectId: $projectId})
       WHERE true ${invalidFilter}
       RETURN count(f) AS total`,
      { userId, projectId },
    );
    const total = (countResult.records[0]?.get('total') as number | null) ?? 0;

    const result = await session.run(
      `MATCH (f:MemoryFact {userId: $userId, projectId: $projectId})
       WHERE true ${invalidFilter}
       RETURN f.id AS factId, f.subject AS subject, f.predicate AS predicate,
              f.object AS object, f.objectIsEntity AS objectIsEntity,
              f.confidence AS confidence, f.episodeId AS episodeId,
              f.validAt AS validAt, f.ingestionAt AS ingestionAt, f.invalidAt AS invalidAt,
              f.contextEntityName AS contextEntityName
       ORDER BY f.validAt DESC
       LIMIT $limit`,
      { userId, projectId, limit: neoLimit },
    );
    const facts = result.records.map((r) => recordToFact(r, userId, projectId, 1.0));
    return { facts, total };
  } finally {
    await session.close();
  }
}

export async function querySemanticRelationships(
  userId: string,
  projectId: string,
  query: string | undefined,
  limit: number,
): Promise<{ relationships: SemanticRelationship[]; total: number }> {
  const neoLimit = neo4j.int(limit);
  const session = neo4jDriver.session();
  try {
    let whereClause = 'WHERE r.invalidAt IS NULL';
    if (query) whereClause += ` AND (r.type CONTAINS toLower($query) OR s.name CONTAINS toLower($query) OR o.name CONTAINS toLower($query))`;

    const countResult = await session.run(
      `MATCH (s:Entity {userId: $userId, projectId: $projectId})-[r:RELATED_TO {userId: $userId, projectId: $projectId}]->(o:Entity)
       ${whereClause}
       RETURN count(r) AS total`,
      { userId, projectId, query: query ?? '' },
    );
    const total = (countResult.records[0]?.get('total') as number | null) ?? 0;

    const result = await session.run(
      `MATCH (s:Entity {userId: $userId, projectId: $projectId})-[r:RELATED_TO {userId: $userId, projectId: $projectId}]->(o:Entity)
       ${whereClause}
       RETURN r.id AS id, s.name AS subject, r.type AS predicate, o.name AS object,
              r.confidence AS confidence, r.validAt AS validAt,
              r.episodeId AS episodeId, r.invalidAt AS invalidAt
       ORDER BY r.validAt DESC
       LIMIT $limit`,
      { userId, projectId, query: query ?? '', limit: neoLimit },
    );

    const relationships: SemanticRelationship[] = result.records.map((r) => ({
      id: r.get('id') as string,
      subject: r.get('subject') as string,
      predicate: r.get('predicate') as string,
      object: r.get('object') as string,
      confidence: r.get('confidence') as number,
      userId,
      projectId,
      episodeId: (r.get('episodeId') as string | null) ?? null,
      validAt: r.get('validAt') as string,
      invalidAt: (r.get('invalidAt') as string | null) ?? null,
    }));

    return { relationships, total };
  } finally {
    await session.close();
  }
}

export async function listSemanticEntities(
  userId: string,
  projectId: string,
): Promise<SemanticEntity[]> {
  const session = neo4jDriver.session();
  try {
    const result = await session.run(
      `MATCH (e:Entity {userId: $userId, projectId: $projectId})
       OPTIONAL MATCH (e)-[:HAS_FACT]->(f:MemoryFact) WHERE f.invalidAt IS NULL
       OPTIONAL MATCH (e)-[r:RELATED_TO {userId: $userId, projectId: $projectId}]->() WHERE r.invalidAt IS NULL
       RETURN e.id AS entityId, e.name AS name, e.type AS type,
              properties(e) AS props,
              count(DISTINCT f) AS factCount, count(DISTINCT r) AS relationshipCount
       ORDER BY factCount + relationshipCount DESC`,
      { userId, projectId },
    );
    return result.records.map((r) => {
      const props = (r.get('props') as Record<string, unknown>) ?? {};
      const { id: _id, name: _name, type: _type, userId: _u, projectId: _p, createdAt: _c, embedding: _e, ...attributes } = props;
      return {
        entityId: r.get('entityId') as string,
        name: r.get('name') as string,
        type: r.get('type') as string,
        attributes: attributes as Record<string, unknown>,
        userId,
        projectId,
        factCount: (r.get('factCount') as number | null) ?? 0,
        relationshipCount: (r.get('relationshipCount') as number | null) ?? 0,
      } as SemanticEntity;
    });
  } finally {
    await session.close();
  }
}

export async function listEntityFacts(
  userId: string,
  projectId: string,
  entityName: string,
): Promise<SemanticFact[]> {
  const session = neo4jDriver.session();
  try {
    const result = await session.run(
      `MATCH (e:Entity {userId: $userId, projectId: $projectId, name: $name})-[:HAS_FACT]->(f:MemoryFact)
       WHERE f.invalidAt IS NULL
       RETURN f.id AS factId, f.subject AS subject, f.predicate AS predicate,
              f.object AS object, f.objectIsEntity AS objectIsEntity,
              f.confidence AS confidence, f.episodeId AS episodeId,
              f.validAt AS validAt, f.ingestionAt AS ingestionAt, f.invalidAt AS invalidAt
       ORDER BY f.validAt DESC`,
      { userId, projectId, name: entityName.toLowerCase().trim() },
    );
    return result.records.map((r) => recordToFact(r, userId, projectId, 1.0));
  } finally {
    await session.close();
  }
}

export async function softDeleteFact(
  factId: string,
  projectId: string,
): Promise<boolean> {
  const session = neo4jDriver.session();
  try {
    const result = await session.run(
      `MATCH (f:MemoryFact {id: $factId, projectId: $projectId})
       WHERE f.invalidAt IS NULL
       SET f.invalidAt = $now
       RETURN f.id AS id`,
      { factId, projectId, now: new Date().toISOString() },
    );
    return result.records.length > 0;
  } finally {
    await session.close();
  }
}

// ── Retry job ─────────────────────────────────────────────────────────────────

export async function retryFailedSemanticMemory(): Promise<void> {
  const rows = await db
    .select({ id: episodes.id, projectId: episodes.projectId, semanticRetryCount: episodes.semanticRetryCount })
    .from(episodes)
    .where(
      and(
        eq(episodes.status, 'completed'),
        inArray(episodes.semanticStatus, ['pending', 'failed']),
      ),
    )
    .limit(20);

  for (const row of rows) {
    const settings = await getSemanticSettings(row.projectId);
    if (row.semanticRetryCount >= settings.maxRetries) continue;

    const [claimed] = await db
      .update(episodes)
      .set({ semanticRetryCount: row.semanticRetryCount + 1, updatedAt: new Date() })
      .where(
        and(
          eq(episodes.id, row.id),
          inArray(episodes.semanticStatus, ['pending', 'failed']),
          eq(episodes.semanticRetryCount, row.semanticRetryCount),
        ),
      )
      .returning({ id: episodes.id });

    if (!claimed) continue;

    processSemanticMemory(row.id).catch((err) => {
      console.error('[semantic] retry failed:', err);
    });
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function recordToFact(
  r: { get: (key: string) => unknown },
  userId: string,
  projectId: string,
  relevanceScore: number,
): SemanticFact {
  return {
    factId: r.get('factId') as string,
    subject: r.get('subject') as string,
    predicate: r.get('predicate') as string,
    object: r.get('object') as string,
    objectIsEntity: (r.get('objectIsEntity') as boolean | null) ?? false,
    confidence: r.get('confidence') as number,
    userId,
    projectId,
    episodeId: (r.get('episodeId') as string | null) ?? null,
    validAt: r.get('validAt') as string,
    ingestionAt: (r.get('ingestionAt') as string | null) ?? (r.get('validAt') as string),
    invalidAt: (r.get('invalidAt') as string | null) ?? null,
    contextEntityName: (r.get('contextEntityName') as string | null) ?? null,
    relevanceScore,
  };
}

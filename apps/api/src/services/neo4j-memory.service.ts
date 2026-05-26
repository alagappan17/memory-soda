import { randomUUID } from 'crypto';
import neo4j from 'neo4j-driver';
import { neo4jDriver } from '../db/neo4j.js';
import { generateEmbedding, extractFacts, classifyFact } from './gemini.service.js';
import type {
  Message,
  ExtractedFact,
  MemoryFact,
  MemoryOperationStep,
  AddMemoryResult,
  ContextFact,
  RetrieveMemoryResult,
} from '@memory-soda/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function entityId(userId: string, type: string, name: string): string {
  return `${userId}:${type}:${name.toLowerCase()}`;
}

function factText(subjectName: string, predicate: string, objectName: string): string {
  const pred = predicate.toLowerCase().replace(/_/g, ' ');
  return `${subjectName} ${pred} ${objectName}`;
}

function neo4jToMemoryFact(node: Record<string, unknown>): MemoryFact {
  return {
    id: node['id'] as string,
    userId: node['userId'] as string,
    text: node['text'] as string,
    predicate: node['predicate'] as string,
    subjectName: node['subjectName'] as string,
    subjectType: node['subjectType'] as MemoryFact['subjectType'],
    objectName: node['objectName'] as string,
    objectType: node['objectType'] as MemoryFact['objectType'],
    confidence: node['confidence'] as number,
    validAt: node['validAt'] as string,
    invalidAt: (node['invalidAt'] as string | null) ?? null,
  };
}

// ── Query existing active facts ───────────────────────────────────────────────

async function queryExistingFacts(
  userId: string,
  subjectName: string,
  predicate: string,
): Promise<MemoryFact[]> {
  const session = neo4jDriver.session();
  try {
    const result = await session.run(
      `MATCH (f:MemoryFact)
       WHERE f.userId = $userId
         AND f.subjectName = $subjectName
         AND f.predicate = $predicate
         AND f.invalidAt IS NULL
       RETURN f
       ORDER BY f.validAt DESC
       LIMIT 5`,
      { userId, subjectName, predicate },
    );
    return result.records.map((r) => neo4jToMemoryFact(r.get('f').properties));
  } finally {
    await session.close();
  }
}

// ── Create a new fact ─────────────────────────────────────────────────────────

async function createFact(
  userId: string,
  fact: ExtractedFact,
  subjectName: string,
): Promise<MemoryFact> {
  const factId = randomUUID();
  const now = new Date().toISOString();
  const text = factText(subjectName, fact.predicate, fact.object);
  const embedding = await generateEmbedding(text);

  const subId = entityId(userId, fact.subjectType, subjectName);
  const objId = entityId(userId, fact.objectType, fact.object);

  const session = neo4jDriver.session();
  try {
    await session.run(
      `MERGE (s:Entity {id: $subId})
         ON CREATE SET s.name = $subjectName, s.type = $subjectType, s.userId = $userId
       MERGE (o:Entity {id: $objId})
         ON CREATE SET o.name = $objectName, o.type = $objectType, o.userId = $userId
       CREATE (f:MemoryFact {
         id: $factId,
         userId: $userId,
         text: $text,
         predicate: $predicate,
         subjectName: $subjectName,
         subjectType: $subjectType,
         objectName: $objectName,
         objectType: $objectType,
         embedding: $embedding,
         confidence: $confidence,
         validAt: $validAt,
         invalidAt: null
       })
       CREATE (s)-[:HAS_FACT]->(f)
       CREATE (o)-[:HAS_FACT]->(f)
       MERGE (s)-[rel:RELATED {predicate: $predicate}]->(o)
         ON CREATE SET rel.factId = $factId, rel.confidence = $confidence, rel.validAt = $validAt, rel.invalidAt = null
         ON MATCH SET rel.factId = $factId, rel.confidence = $confidence, rel.validAt = $validAt, rel.invalidAt = null`,
      {
        subId,
        objId,
        factId,
        userId,
        text,
        predicate: fact.predicate,
        subjectName,
        subjectType: fact.subjectType,
        objectName: fact.object,
        objectType: fact.objectType,
        embedding,
        confidence: fact.confidence,
        validAt: now,
      },
    );

    return {
      id: factId,
      userId,
      text,
      predicate: fact.predicate,
      subjectName,
      subjectType: fact.subjectType,
      objectName: fact.object,
      objectType: fact.objectType,
      confidence: fact.confidence,
      validAt: now,
      invalidAt: null,
    };
  } finally {
    await session.close();
  }
}

// ── Invalidate an existing fact ───────────────────────────────────────────────

async function invalidateFact(factId: string): Promise<void> {
  const now = new Date().toISOString();
  const session = neo4jDriver.session();
  try {
    await session.run(
      `MATCH (f:MemoryFact {id: $factId})
       SET f.invalidAt = $now`,
      { factId, now },
    );
  } finally {
    await session.close();
  }
}

// ── Reinforce (bump confidence) ───────────────────────────────────────────────

async function reinforceFact(factId: string, _newConfidence: number): Promise<void> {
  const session = neo4jDriver.session();
  try {
    await session.run(
      `MATCH (f:MemoryFact {id: $factId})
       SET f.confidence = CASE
         WHEN f.confidence + 0.05 > 1.0 THEN 1.0
         ELSE f.confidence + 0.05
       END,
       f.lastSeen = $now`,
      { factId, now: new Date().toISOString() },
    );
  } finally {
    await session.close();
  }
}

// ── Public: add memory ────────────────────────────────────────────────────────

export async function addMemory(userId: string, messages: Message[]): Promise<AddMemoryResult> {
  const log: MemoryOperationStep[] = [];

  // Step 1: extract facts
  const facts = await extractFacts(messages);
  log.push({
    type: 'extract',
    message: facts.length > 0
      ? `Extracted ${facts.length} fact${facts.length === 1 ? '' : 's'} from conversation`
      : 'No facts found in conversation',
  });

  let factsCreated = 0;
  let factsUpdated = 0;
  let factsInvalidated = 0;

  for (const fact of facts) {
    // Normalise subject: if it refers to the user, pin to userId
    const subjectName =
      fact.subjectType === 'User' ||
      fact.subject.toLowerCase() === 'user' ||
      fact.subject.toLowerCase() === 'i'
        ? userId
        : fact.subject;

    // Step 2: resolve nodes + query existing
    const existing = await queryExistingFacts(userId, subjectName, fact.predicate);

    if (existing.length === 0) {
      await createFact(userId, { ...fact, subject: subjectName }, subjectName);
      factsCreated++;
      log.push({
        type: 'create',
        fact,
        message: `Created: "${subjectName} ${fact.predicate} ${fact.object}"`,
      });
    } else {
      // Step 3: classify
      const classification = await classifyFact(fact, existing);
      log.push({
        type: 'classify',
        fact,
        existingFact: existing[0],
        classification,
        message: `${classification}: "${subjectName} ${fact.predicate} ${fact.object}"`,
      });

      if (classification === 'CONTRADICTION') {
        for (const old of existing) {
          await invalidateFact(old.id);
          factsInvalidated++;
          log.push({
            type: 'invalidate',
            existingFact: old,
            message: `Invalidated old fact: "${old.text}"`,
          });
        }
        await createFact(userId, { ...fact, subject: subjectName }, subjectName);
        factsCreated++;
        log.push({
          type: 'create',
          fact,
          message: `Created replacement: "${subjectName} ${fact.predicate} ${fact.object}"`,
        });
      } else if (classification === 'REINFORCEMENT') {
        await reinforceFact(existing[0]!.id, fact.confidence);
        factsUpdated++;
        log.push({
          type: 'update',
          existingFact: existing[0],
          message: `Reinforced confidence for: "${existing[0]!.text}"`,
        });
      } else {
        // NEW — different object despite same predicate (e.g. multiple INTERESTED_IN)
        await createFact(userId, { ...fact, subject: subjectName }, subjectName);
        factsCreated++;
        log.push({
          type: 'create',
          fact,
          message: `Created (additive): "${subjectName} ${fact.predicate} ${fact.object}"`,
        });
      }
    }
  }

  return { userId, factsExtracted: facts.length, factsCreated, factsUpdated, factsInvalidated, log };
}

// ── Public: retrieve memory ───────────────────────────────────────────────────

export async function retrieveMemory(
  userId: string,
  query: string,
  limit = 10,
): Promise<RetrieveMemoryResult> {
  const embedding = await generateEmbedding(query);

  const session = neo4jDriver.session();
  let vectorFacts: ContextFact[] = [];

  try {
    // Vector search on MemoryFact nodes
    const vectorResult = await session.run(
      `CALL db.index.vector.queryNodes('memory_facts_embedding', 20, $embedding)
       YIELD node AS fact, score
       WHERE fact.userId = $userId AND fact.invalidAt IS NULL
       RETURN fact, score
       ORDER BY score DESC
       LIMIT $limit`,
      { embedding, userId, limit: neo4j.int(limit) },
    );

    vectorFacts = vectorResult.records.map((r) => {
      const f = r.get('fact').properties as Record<string, unknown>;
      return {
        text: f['text'] as string,
        predicate: f['predicate'] as string,
        subject: f['subjectName'] as string,
        object: f['objectName'] as string,
        confidence: f['confidence'] as number,
        validAt: f['validAt'] as string,
        score: r.get('score') as number,
      };
    });

    // Graph expand: get all active facts connected to matched entity nodes
    if (vectorFacts.length > 0) {
      const subjectNames = [...new Set(vectorFacts.map((f) => f.subject))];
      const expandResult = await session.run(
        `UNWIND $subjectNames AS name
         MATCH (f:MemoryFact)
         WHERE f.userId = $userId
           AND f.subjectName = name
           AND f.invalidAt IS NULL
         RETURN f`,
        { subjectNames, userId },
      );

      const expanded: ContextFact[] = expandResult.records.map((r) => {
        const f = r.get('f').properties as Record<string, unknown>;
        return {
          text: f['text'] as string,
          predicate: f['predicate'] as string,
          subject: f['subjectName'] as string,
          object: f['objectName'] as string,
          confidence: f['confidence'] as number,
          validAt: f['validAt'] as string,
        };
      });

      // Merge, deduplicate by text
      const seen = new Set(vectorFacts.map((f) => f.text));
      for (const f of expanded) {
        if (!seen.has(f.text)) {
          seen.add(f.text);
          vectorFacts.push(f);
        }
      }
    }
  } finally {
    await session.close();
  }

  // Sort: vector results first (have score), then expanded
  const sorted = vectorFacts.sort((a, b) => {
    const sa = a.score ?? 0;
    const sb = b.score ?? 0;
    return sb - sa;
  });

  const contextText = buildContextText(sorted);
  return { facts: sorted, contextText };
}

function buildContextText(facts: ContextFact[]): string {
  if (facts.length === 0) return '';

  const lines = facts.map((f) => {
    const since = f.validAt ? new Date(f.validAt).toLocaleDateString() : 'unknown';
    const conf = Math.round(f.confidence * 100);
    return `- ${f.text} (confidence: ${conf}%, since: ${since})`;
  });

  return `Here is what you know about this user:\n${lines.join('\n')}`;
}

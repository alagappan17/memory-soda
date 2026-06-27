import { neo4jDriver } from './neo4j.js';

export async function initNeo4j(): Promise<void> {
  const session = neo4jDriver.session();
  try {
    // ── MemoryFact vector index ───────────────────────────────────────────────
    await session.run(`DROP INDEX memory_facts_embedding IF EXISTS`);
    await session.run(`
      CREATE VECTOR INDEX memory_facts_embedding
      FOR (f:MemoryFact) ON (f.embedding)
      OPTIONS {indexConfig: {
        \`vector.dimensions\`: 768,
        \`vector.similarity_function\`: 'cosine'
      }}
    `);

    // ── Entity vector index (for embedding-based entity resolution) ───────────
    await session.run(`DROP INDEX entity_embedding IF EXISTS`);
    await session.run(`
      CREATE VECTOR INDEX entity_embedding
      FOR (e:Entity) ON (e.embedding)
      OPTIONS {indexConfig: {
        \`vector.dimensions\`: 768,
        \`vector.similarity_function\`: 'cosine'
      }}
    `);

    // ── Uniqueness constraints ────────────────────────────────────────────────
    await session.run(`
      CREATE CONSTRAINT memory_fact_id IF NOT EXISTS
      FOR (f:MemoryFact) REQUIRE f.id IS UNIQUE
    `);

    await session.run(`
      CREATE CONSTRAINT entity_id IF NOT EXISTS
      FOR (e:Entity) REQUIRE e.id IS UNIQUE
    `);

    // ── Lookup indexes ────────────────────────────────────────────────────────
    await session.run(`
      CREATE INDEX entity_user_project_name IF NOT EXISTS
      FOR (e:Entity) ON (e.userId, e.projectId, e.name)
    `);

    await session.run(`
      CREATE INDEX related_to_user_project IF NOT EXISTS
      FOR ()-[r:RELATED_TO]-() ON (r.userId, r.projectId)
    `);

    await session.run(`
      CREATE INDEX related_to_type IF NOT EXISTS
      FOR ()-[r:RELATED_TO]-() ON (r.type)
    `);

    console.log('[ neo4j ] schema initialised');
  } catch (err) {
    console.error('[ neo4j ] failed to initialise schema:', err);
  } finally {
    await session.close();
  }
}

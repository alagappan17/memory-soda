import { neo4jDriver } from './neo4j.js';

export async function initNeo4j(): Promise<void> {
  const session = neo4jDriver.session();
  try {
    // Drop and recreate vector index to ensure correct dimensions
    await session.run(`DROP INDEX memory_facts_embedding IF EXISTS`);
    await session.run(`
      CREATE VECTOR INDEX memory_facts_embedding
      FOR (f:MemoryFact) ON (f.embedding)
      OPTIONS {indexConfig: {
        \`vector.dimensions\`: 3072,
        \`vector.similarity_function\`: 'cosine'
      }}
    `);

    // Uniqueness constraints
    await session.run(`
      CREATE CONSTRAINT memory_fact_id IF NOT EXISTS
      FOR (f:MemoryFact) REQUIRE f.id IS UNIQUE
    `);

    await session.run(`
      CREATE CONSTRAINT entity_id IF NOT EXISTS
      FOR (e:Entity) REQUIRE e.id IS UNIQUE
    `);

    console.log('[ neo4j ] schema initialised');
  } catch (err) {
    console.error('[ neo4j ] failed to initialise schema:', err);
  } finally {
    await session.close();
  }
}

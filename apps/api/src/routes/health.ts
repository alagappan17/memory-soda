import { Router } from 'express';
import { Pool } from 'pg';
import Redis from 'ioredis';
import neo4j from 'neo4j-driver';
import type { HealthResponse, ServiceStatus } from '@memory-soda/types';

const router = Router();

router.get('/', async (_req, res) => {
  const [postgres, redis, neo4jStatus] = await Promise.all([
    checkPostgres(),
    checkRedis(),
    checkNeo4j(),
  ]);

  const services = { postgres, redis, neo4j: neo4jStatus };
  const status: ServiceStatus = Object.values(services).every((s) => s === 'ok') ? 'ok' : 'error';

  const body: HealthResponse = { status, services };
  res.status(status === 'ok' ? 200 : 503).json(body);
});

async function checkPostgres(): Promise<ServiceStatus> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query('SELECT 1');
    return 'ok';
  } catch {
    return 'error';
  } finally {
    await pool.end();
  }
}

async function checkRedis(): Promise<ServiceStatus> {
  const client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    lazyConnect: true,
    connectTimeout: 3000,
  });
  try {
    await client.connect();
    await client.ping();
    return 'ok';
  } catch {
    return 'error';
  } finally {
    client.disconnect();
  }
}

async function checkNeo4j(): Promise<ServiceStatus> {
  const driver = neo4j.driver(
    process.env.NEO4J_URI ?? 'bolt://localhost:7687',
    neo4j.auth.basic(
      process.env.NEO4J_USERNAME ?? 'neo4j',
      process.env.NEO4J_PASSWORD ?? 'password'
    )
  );
  try {
    await driver.verifyConnectivity();
    return 'ok';
  } catch {
    return 'error';
  } finally {
    await driver.close();
  }
}

export default router;

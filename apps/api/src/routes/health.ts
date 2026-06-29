import { Router } from 'express';
import Redis from 'ioredis';
import { pool } from '../db/postgres.js';
import type { HealthResponse, ServiceStatus } from '@memory-soda/types';

const router = Router();

router.get('/', async (_req, res) => {
  const [postgres, redis] = await Promise.all([checkPostgres(), checkRedis()]);

  const services = { postgres, redis };
  const status: ServiceStatus = Object.values(services).every((s) => s === 'ok') ? 'ok' : 'error';

  const body: HealthResponse = { status, services };
  res.status(status === 'ok' ? 200 : 503).json(body);
});

async function checkPostgres(): Promise<ServiceStatus> {
  try {
    await pool.query('SELECT 1');
    return 'ok';
  } catch {
    return 'error';
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

export default router;

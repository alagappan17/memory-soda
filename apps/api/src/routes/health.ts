import { Router } from 'express';
import { pool } from '../db/postgres.js';
import type { HealthResponse, ServiceStatus } from '@memory-soda/types';

const router = Router();

router.get('/', async (_req, res) => {
  const postgres = await checkPostgres();

  const services = { postgres };
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

export default router;

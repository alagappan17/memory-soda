import { Router } from 'express';
import { checkPostgres } from '../db/postgres.js';
import type { HealthResponse, ServiceStatus } from '@memory-soda/types';

const router = Router();

router.get('/', async (_req, res) => {
  const postgres: ServiceStatus = await checkPostgres().then(
    () => 'ok',
    () => 'error',
  );

  const services = { postgres };
  const status: ServiceStatus = Object.values(services).every((s) => s === 'ok')
    ? 'ok'
    : 'error';

  const body: HealthResponse = { status, services };
  res.status(status === 'ok' ? 200 : 503).json(body);
});

export default router;

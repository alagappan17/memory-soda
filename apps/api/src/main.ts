import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import pinoHttp from 'pino-http';
import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import healthRouter from './routes/health.js';
import apiKeysRouter from './routes/api-keys.js';
import projectsRouter from './routes/projects.js';
import { requireApiKey } from './middleware/auth.js';
import workingMemoryRouter from './routes/working-memory.js';
import episodicMemoryRouter from './routes/episodic-memory.js';
import semanticMemoryRouter from './routes/semantic-memory.js';
import threadRouter from './routes/thread.js';
import threadsRouter from './routes/threads.js';
import generateRouter from './routes/generate.js';
import { notFoundHandler, errorHandler } from './middleware/error-handler.js';
import { reapIdempotencyKeys } from './middleware/idempotency.js';
import { logger } from './lib/logger.js';
import { initNeo4j } from './db/neo4j-init.js';
import { db, pool, checkPostgres } from './db/postgres.js';
import { neo4jDriver } from './db/neo4j.js';
import { listApiKeys, createApiKey } from './services/api-key.service.js';
import {
  retryFailedEpisodes,
  processScheduledEpisodes,
} from './services/episodic-memory.service.js';
import { retryFailedSemanticMemory } from './services/semantic-memory.service.js';

// In compiled output (dist/apps/api/src/), drizzle/ is at dist/drizzle/
const MIGRATIONS_FOLDER = path.join(__dirname, '../../../drizzle');

const host = process.env.HOST ?? 'localhost';
const port = process.env.PORT ? Number(process.env.PORT) : 3004;

const app = express();

const corsOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim());
app.use(
  cors({ origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins }),
);
app.use(express.json({ limit: '1mb' }));
app.use(
  pinoHttp({
    logger,
    genReqId: (req, res) => {
      const existing = req.headers['x-request-id'];
      const id =
        (Array.isArray(existing) ? existing[0] : existing) ?? randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    customSuccessMessage: (req, res, responseTime) =>
      `${req.method} ${req.url} ${res.statusCode} ${responseTime}ms`,
    customErrorMessage: (req, res, err) =>
      `${req.method} ${req.url} ${res.statusCode} — ${err.message}`,
    serializers: {
      req: () => ({}),
      res: () => ({}),
    },
  }),
);

app.use('/health', healthRouter);

// Dashboard Routes
app.use('/dashboard/api-keys', apiKeysRouter);
app.use('/dashboard/projects', projectsRouter);
app.use('/dashboard/threads', threadsRouter);
app.use('/dashboard/generate', generateRouter);

// Protected routes (SDK usage — require API key)
app.use(requireApiKey);
app.use('/v1/threads', threadRouter);
app.use('/v1/memory/threads', workingMemoryRouter);
app.use('/v1/memory/episodic', episodicMemoryRouter);
app.use('/v1/memory/semantic', semanticMemoryRouter);

// Terminal handlers — must be last.
app.use(notFoundHandler);
app.use(errorHandler);

async function bootstrap(): Promise<void> {
  await checkPostgres();
  logger.info('[ postgres ] connected');

  if (process.env.MIGRATE_ON_START === 'true') {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    logger.info('[ db ] migrations applied');
  }

  await initNeo4j();

  const existingKeys = await listApiKeys();
  if (existingKeys.length === 0) {
    const { key } = await createApiKey('default');
    logger.info(
      { apiKey: key },
      'First-time setup — save this API key, it will not be shown again',
    );
  }

  const server = app.listen(port, host, () => {
    logger.info(`[ ready ] http://${host}:${port}`);
  });

  const intervals = [
    setInterval(() => {
      retryFailedEpisodes().catch((err) =>
        logger.error({ err }, '[episodic] retry job failed'),
      );
    }, 120_000),
    setInterval(() => {
      processScheduledEpisodes().catch((err) =>
        logger.error({ err }, '[episodic] scheduled episodes job failed'),
      );
    }, 5_000),
    setInterval(() => {
      retryFailedSemanticMemory().catch((err) =>
        logger.error({ err }, '[semantic] retry job failed'),
      );
    }, 120_000),
    setInterval(() => {
      reapIdempotencyKeys().catch((err) =>
        logger.error({ err }, '[idempotency] reaper failed'),
      );
    }, 3_600_000),
  ];
  for (const i of intervals) i.unref();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`[ shutdown ] received ${signal}, draining...`);
    for (const i of intervals) clearInterval(i);
    server.close(() => logger.info('[ shutdown ] http server closed'));
    try {
      await Promise.allSettled([pool.end(), neo4jDriver.close()]);
    } finally {
      logger.info('[ shutdown ] resources released');
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.error({ err }, '[ startup ] failed');
  process.exit(1);
});

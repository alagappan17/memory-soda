import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import healthRouter from './routes/health.js';
import apiKeysRouter from './routes/api-keys.js';
import projectsRouter from './routes/projects.js';
import { requireApiKey } from './middleware/auth.js';
import workingMemoryRouter from './routes/working-memory.js';
import episodicMemoryRouter from './routes/episodic-memory.js';
import threadRouter from './routes/thread.js';
import threadsRouter from './routes/threads.js';
import { db, checkPostgres } from './db/postgres.js';
import { listApiKeys, createApiKey } from './services/api-key.service.js';
import {
  retryFailedEpisodes,
  processScheduledEpisodes,
} from './services/episodic-memory.service.js';

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
app.use(morgan('dev'));

app.use('/health', healthRouter);

// Dashboard Routes
app.use('/dashboard/api-keys', apiKeysRouter);
app.use('/dashboard/projects', projectsRouter);
app.use('/dashboard/threads', threadsRouter);

// Protected routes (SDK usage — require API key)
app.use(requireApiKey);
app.use('/v1/threads', threadRouter);
app.use('/v1/memory/working', workingMemoryRouter);
app.use('/v1/memory/episodic', episodicMemoryRouter);

async function bootstrap(): Promise<void> {
  await checkPostgres();
  console.log('[ postgres ] connected');

  if (process.env.MIGRATE_ON_START === 'true') {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    console.log('[ db ] migrations applied');
  }

  const existingKeys = await listApiKeys();
  if (existingKeys.length === 0) {
    const { key } = await createApiKey('default');
    const line = `│  API Key: ${key}`;
    const padded = line.padEnd(50) + '│';
    console.log('');
    console.log('┌──────────────────────────────────────────────────┐');
    console.log('│  Memory Soda — First-time setup                  │');
    console.log('│                                                  │');
    console.log(padded);
    console.log('│                                                  │');
    console.log('│  Save this — it will not be shown again.         │');
    console.log('└──────────────────────────────────────────────────┘');
    console.log('');
  }

  app.listen(port, host, () => {
    console.log(`[ ready ] http://${host}:${port}`);
  });

  setInterval(() => {
    retryFailedEpisodes().catch((err) => {
      console.error('[episodic] retry job failed:', err);
    });
  }, 120_000).unref();

  setInterval(() => {
    processScheduledEpisodes().catch((err) => {
      console.error('[episodic] scheduled episodes job failed:', err);
    });
  }, 5_000).unref();
}

bootstrap().catch((err) => {
  console.error('[ startup ] failed:', err);
  process.exit(1);
});

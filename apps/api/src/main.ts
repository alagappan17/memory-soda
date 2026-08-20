import express from 'express';
import { randomBytes } from 'node:crypto';
import cors from 'cors';
import morgan from 'morgan';
import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import healthRouter from './routes/health.js';
import apiKeysRouter from './routes/api-keys.js';
import projectsRouter from './routes/projects.js';
import authRouter from './routes/auth.js';
import usersRouter from './routes/users.js';
import { requireApiKey } from './middleware/auth.js';
import { requireSession } from './middleware/session.js';
import workingMemoryRouter from './routes/working-memory.js';
import episodicMemoryRouter from './routes/episodic-memory.js';
import semanticMemoryRouter from './routes/semantic-memory.js';
import threadRouter from './routes/thread.js';
import threadsRouter from './routes/threads.js';
import dashboardDatasetsRouter from './routes/dashboard-datasets.js';
import recallRouter from './routes/recall.js';
import { config } from './config.js';
import { db, checkPostgres } from './db/postgres.js';
import { listApiKeys, createApiKey } from './services/api-key.service.js';
import { countUsers, createUser } from './services/user.service.js';
import {
  retryFailedEpisodes,
  processScheduledEpisodes,
} from './services/episodic-memory.service.js';
import { sweepSemanticMemory } from './services/semantic-memory.service.js';

// In compiled output (dist/apps/api/src/), drizzle/ is at dist/drizzle/
const MIGRATIONS_FOLDER = path.join(__dirname, '../../../drizzle');

const { host, port } = config.server;

const app = express();

const corsOrigins = config.server.corsOrigins;
app.use(
  cors({ origin: corsOrigins.length === 1 ? corsOrigins[0] : [...corsOrigins] }),
);
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

app.use('/health', healthRouter);

// Public auth routes (login/logout/me)
app.use('/auth', authRouter);

// Dashboard Routes — gated by a login session.
app.use('/dashboard', requireSession);
app.use('/dashboard/users', usersRouter);
app.use('/dashboard/api-keys', apiKeysRouter);
app.use('/dashboard/projects', projectsRouter);
app.use('/dashboard/threads', threadsRouter);
app.use('/dashboard/datasets', dashboardDatasetsRouter);

// Protected routes (SDK usage — require API key)
app.use(requireApiKey);
app.use('/v1/threads', threadRouter);
app.use('/v1/memory/working', workingMemoryRouter);
app.use('/v1/memory/episodic', episodicMemoryRouter);
app.use('/v1/memory/semantic', semanticMemoryRouter);
app.use('/v1/memory/recall', recallRouter);

async function bootstrap(): Promise<void> {
  await checkPostgres();
  console.log('[ postgres ] connected');

  if (config.server.migrateOnStart) {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    console.log('[ db ] migrations applied');
  }

  // First-time setup: seed a default API key and an admin login user, then
  // print their credentials once. The API key is never shown again; the admin
  // password can be changed later from the Users page.
  const setupLines: string[] = [];

  const existingKeys = await listApiKeys();
  if (existingKeys.length === 0) {
    const { key } = await createApiKey('default');
    setupLines.push(`API Key:  ${key}`);
  }

  if ((await countUsers()) === 0) {
    const adminUsername = config.admin.username;
    // Never fall back to a fixed password: a literal here is in the published
    // source, so every deployment that skips ADMIN_PASSWORD would ship the same
    // known credentials. A random one is printed once, below.
    const generated = config.admin.password === undefined;
    const adminPassword =
      config.admin.password ?? randomBytes(12).toString('base64url');
    await createUser(adminUsername, adminPassword);
    setupLines.push(`Login:    ${adminUsername} / ${adminPassword}`);
    if (generated) {
      setupLines.push('          (generated — set ADMIN_PASSWORD to choose)');
    }
  }

  if (setupLines.length > 0) {
    // Width is derived from the content so the box can't drift out of
    // alignment when a credential line changes length.
    const rows = [
      'Memory Soda — First-time setup',
      '',
      ...setupLines,
      '',
      'Save these — the API key will not be shown again.',
    ];
    const inner = Math.max(...rows.map((r) => r.length)) + 4;
    const bar = '─'.repeat(inner);
    console.log(`\n┌${bar}┐`);
    for (const row of rows) console.log(`│  ${row.padEnd(inner - 2)}│`);
    console.log(`└${bar}┘\n`);
  }

  app.listen(port, host, () => {
    console.log(`[ ready ] http://${host}:${port}`);
  });

  setInterval(() => {
    retryFailedEpisodes().catch((err) => {
      console.error('[episodic] retry job failed:', err);
    });
  }, 120_000).unref();

  // Backstop for semantic extraction: picks up pending episodes whose
  // completion trigger was missed (or that a migration reset) and bounded
  // retries of failed ones.
  setInterval(() => {
    sweepSemanticMemory().catch((err) => {
      console.error('[semantic] sweep job failed:', err);
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

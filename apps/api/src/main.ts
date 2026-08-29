import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import cors from 'cors';
import morgan from 'morgan';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { config } from './config.js';
import { db, checkPostgres } from './db/postgres.js';
import { AppError, isAppError } from './lib/errors.js';
import { requireApiKey, requireSession } from './middleware/authenticate.js';
import { projectFromQuery } from './middleware/project-scope.js';

import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import memoryRouter from './routes/memory/index.js';
import projectsRouter from './routes/admin/projects.js';
import apiKeysRouter from './routes/admin/api-keys.js';
import usersRouter from './routes/admin/users.js';
import browseRouter from './routes/admin/browse.js';
import chatRouter from './routes/admin/chat.js';

import { listApiKeys, createApiKey } from './services/api-key.service.js';
import { countUsers, createUser } from './services/user.service.js';
import { startWorker } from './worker.js';

// In compiled output (dist/apps/api/src/), drizzle/ sits at dist/drizzle/.
const MIGRATIONS_FOLDER = path.join(__dirname, '../../../drizzle');

const { host, port, corsOrigins } = config.server;

const app = express();

app.use(cors({ origin: [...corsOrigins] }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

app.use('/health', healthRouter);
app.use('/auth', authRouter);

// ── SDK surface ──────────────────────────────────────────────────────────────
// The API key names the project, so no other scoping is needed.
app.use('/v1', requireApiKey, memoryRouter);

// ── Dashboard surface ────────────────────────────────────────────────────────
// The same memory router under a login session. A session can see several
// projects, so the project comes from `?projectId=` instead of the credential.
app.use('/dashboard/v1', requireSession, projectFromQuery, memoryRouter);
app.use('/dashboard/chat', requireSession, projectFromQuery, chatRouter);
app.use('/dashboard/browse', requireSession, projectFromQuery, browseRouter);
app.use('/dashboard/projects', requireSession, projectsRouter);
app.use('/dashboard/api-keys', requireSession, apiKeysRouter);
app.use('/dashboard/users', requireSession, usersRouter);

app.use((req, res) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
});

/**
 * The one place a failure becomes a response.
 *
 * Services throw {@link AppError} for anything the caller should see; anything
 * else is a bug, and its message stays in the logs rather than the response
 * body where it could leak a query or a connection string.
 */
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (isAppError(err)) {
    res.status(err.status).json({
      error: err.message,
      ...(err.details === undefined ? {} : { issues: err.details }),
    });
    return;
  }
  console.error('[api] unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

/**
 * First-time setup: seed a default API key and an admin login, and print both
 * once. The key is never shown again; the password can be changed from the
 * Users page.
 */
async function printFirstRunCredentials(): Promise<void> {
  const lines: string[] = [];

  if ((await listApiKeys()).length === 0) {
    const { key } = await createApiKey('default');
    lines.push(`API Key:  ${key}`);
  }

  if ((await countUsers()) === 0) {
    // Never fall back to a fixed password: a literal here ships in the
    // published source, so every deployment that skips ADMIN_PASSWORD would
    // share known credentials. A random one is printed once instead.
    const generated = config.admin.password === undefined;
    const password = config.admin.password ?? randomBytes(12).toString('base64url');
    await createUser(config.admin.username, password);
    lines.push(`Login:    ${config.admin.username} / ${password}`);
    if (generated) {
      lines.push('          (generated, set ADMIN_PASSWORD to choose)');
    }
  }

  if (lines.length === 0) return;

  // Width derived from the content so the box can't drift out of alignment
  // when a credential line changes length.
  const rows = [
    'Memory Soda, First-time setup',
    '',
    ...lines,
    '',
    'Save these, the API key will not be shown again.',
  ];
  const inner = Math.max(...rows.map((r) => r.length)) + 4;
  const bar = '─'.repeat(inner);
  console.log(`\n┌${bar}┐`);
  for (const row of rows) console.log(`│  ${row.padEnd(inner - 2)}│`);
  console.log(`└${bar}┘\n`);
}

async function bootstrap(): Promise<void> {
  await checkPostgres();
  console.log('[ postgres ] connected');

  if (config.server.migrateOnStart) {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    console.log('[ db ] migrations applied');
  }

  await printFirstRunCredentials();

  app.listen(port, host, () => {
    console.log(`[ ready ] http://${host}:${port}`);
  });

  startWorker();
}

bootstrap().catch((err) => {
  console.error('[ startup ] failed:', err);
  process.exit(1);
});

export { app, AppError };

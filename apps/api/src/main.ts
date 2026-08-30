import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

import {
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_ADMIN_USERNAME,
} from '@memory-soda/types';

import { app } from './app.js';
import { config } from './config.js';
import { db, checkPostgres } from './db/postgres.js';
import { AppError } from './lib/errors.js';
import { getOrCreateDefaultProject } from './services/project.service.js';
import { countUsers, createUser } from './services/user.service.js';
import { startWorker } from './worker.js';
import { usageLogs } from './db/schema.js';
import { flush, startUsageFlusher } from './lib/usage.js';

// In compiled output (dist/apps/api/src/), drizzle/ sits at dist/drizzle/.
const MIGRATIONS_FOLDER = path.join(__dirname, '../../../drizzle');

const { host, port } = config.server;

/** First-time setup: seed the admin login and a project to land in. */
async function seedAdminUser(): Promise<void> {
  if ((await countUsers()) > 0) return;

  // Same project an API key gets when created without one, so the dashboard
  // is never empty on first sign-in.
  await getOrCreateDefaultProject();

  // A known default (Grafana-style) beats a password buried in logs. The
  // dashboard keeps a banner up until it is changed.
  await createUser(DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_PASSWORD);
  console.log(
    `[ setup ] admin user "${DEFAULT_ADMIN_USERNAME}" created. Sign in to the dashboard and change the password.`,
  );
}

async function bootstrap(): Promise<void> {
  await checkPostgres();
  console.log('[ postgres ] connected');

  if (config.server.migrateOnStart) {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    console.log('[ db ] migrations applied');
  }

  await seedAdminUser();

  app.listen(port, host, () => {
    console.log(`[ ready ] http://${host}:${port}`);
  });

  startWorker();
  startUsageFlusher((rows) => db.insert(usageLogs).values(rows));

  // Drain the usage buffer before the process goes away.
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sig, () => {
      void flush().finally(() => process.exit(0));
    });
  }
}

bootstrap().catch((err) => {
  console.error('[ startup ] failed:', err);
  process.exit(1);
});

export { app, AppError };

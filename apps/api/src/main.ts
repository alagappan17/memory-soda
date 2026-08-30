import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { app } from './app.js';
import { config } from './config.js';
import { db, checkPostgres } from './db/postgres.js';
import { AppError } from './lib/errors.js';
import { countUsers, createUser } from './services/user.service.js';
import { startWorker } from './worker.js';

// In compiled output (dist/apps/api/src/), drizzle/ sits at dist/drizzle/.
const MIGRATIONS_FOLDER = path.join(__dirname, '../../../drizzle');

const { host, port } = config.server;

/** First-time setup: seed the admin login. Nothing else is created or shown. */
async function seedAdminUser(): Promise<void> {
  if ((await countUsers()) > 0) return;

  // A known default (Grafana-style) beats a password buried in logs. The
  // dashboard keeps a banner up until it is changed.
  await createUser(config.admin.username, config.admin.password);
  console.log(
    `[ setup ] admin user "${config.admin.username}" created. Sign in to the dashboard and change the password.`,
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
}

bootstrap().catch((err) => {
  console.error('[ startup ] failed:', err);
  process.exit(1);
});

export { app, AppError };

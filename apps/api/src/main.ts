import { randomBytes } from 'node:crypto';
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

  // Never fall back to a fixed password: a literal here ships in the
  // published source, so every deployment that skips ADMIN_PASSWORD would
  // share known credentials. A random one is generated and shown once instead.
  const generated = config.admin.password === undefined;
  const password = config.admin.password ?? randomBytes(12).toString('base64url');
  await createUser(config.admin.username, password);

  console.log(
    generated
      ? `[ setup ] admin user "${config.admin.username}" created with a generated password: ${password} (set ADMIN_PASSWORD to choose one)`
      : `[ setup ] Log in to the dashboard with the admin login you created (${config.admin.username}) to get started.`,
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

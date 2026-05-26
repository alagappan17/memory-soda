import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './postgres.js';

// __dirname in compiled output: dist/apps/api/src/db/
// migrations copied to:         dist/drizzle/
const migrationsFolder = path.join(__dirname, '../../../../drizzle');

async function runMigrations(): Promise<void> {
  console.log('[ db ] running migrations from:', migrationsFolder);
  await migrate(db, { migrationsFolder });
  console.log('[ db ] migrations complete');
  await pool.end();
}

runMigrations().catch((err) => {
  console.error('[ db ] migration failed:', err);
  process.exit(1);
});

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';
import { config } from '../config.js';

export const pool = new Pool({
  connectionString: config.db.url,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 2_000,
});

pool.on('error', (err) => {
  console.error('[ postgres ] unexpected client error', err);
  process.exit(1);
});

export const db = drizzle(pool, {
  schema,
});

/**
 * Whether an error is a Postgres unique-constraint violation (SQLSTATE 23505).
 *
 * Drizzle wraps driver errors in `DrizzleQueryError`, so the pg error — and the
 * `code` — sits on `.cause`, not on the thrown error itself. Reading `err.code`
 * directly silently never matches, turning a 409 into a 500.
 */
export function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 5; depth++) {
    if ((e as { code?: unknown }).code === '23505') return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

export async function checkPostgres(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}

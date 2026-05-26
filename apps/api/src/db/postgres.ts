import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
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
  logger: process.env.NODE_ENV === 'development',
});

export async function checkPostgres(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}

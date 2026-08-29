import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
// Type-only: the real modules are imported after the environment is set.
import type { db as Db } from '../db/postgres.js';
import type * as Schema from '../db/schema.js';

/**
 * One Postgres database per test file.
 *
 * `node --test` runs files in parallel processes and `config.ts` reads the
 * environment once at import, so each file sets its env, creates a fresh
 * database, then dynamically imports the app. Needs a server with pgvector.
 *
 * TEST_DATABASE_URL points at any database on that server; the harness only
 * uses it to CREATE/DROP its own.
 */
const ADMIN_URL =
  process.env['TEST_DATABASE_URL'] ??
  'postgresql://localhost:5432/postgres';

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));

export interface Api {
  baseUrl: string;
  /** Raw fetch against the app; JSON in, JSON out. */
  call: (
    method: string,
    path: string,
    opts?: { body?: unknown; token?: string },
  ) => Promise<{ status: number; body: any }>;
  /** A project plus an API key scoped to it. */
  project: () => Promise<{ projectId: string; key: string }>;
  /** A dashboard user plus a login session token. */
  login: () => Promise<{ userId: string; token: string; username: string }>;
  db: typeof Db;
  schema: typeof Schema;
  stop: () => Promise<void>;
}

export async function startApi(name: string): Promise<Api> {
  const dbName = `msoda_test_${name}_${process.pid}`;
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}"`);
  await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  // pgvector is not a trusted extension, so the migration's CREATE EXTENSION
  // only works for a superuser. Do it here once, with the admin credential.
  const fresh = new Client({ connectionString: url.toString() });
  await fresh.connect();
  await fresh.query('CREATE EXTENSION IF NOT EXISTS vector');
  await fresh.end();

  process.env['DATABASE_URL'] = url.toString();
  process.env['GOOGLE_GENERATIVE_AI_API_KEY'] ??= 'test-key';
  process.env['NODE_ENV'] = 'test';

  const { db, pool } = await import('../db/postgres.js');
  const schema = await import('../db/schema.js');
  await migrate(db, { migrationsFolder: MIGRATIONS });
  const { app } = await import('../app.js');
  const { createApiKey } = await import('../services/api-key.service.js');
  const { createProject } = await import('../services/project.service.js');
  const { createUser } = await import('../services/user.service.js');
  const { createSession } = await import('../services/session.service.js');

  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${port}`;

  let n = 0;
  return {
    baseUrl,
    db,
    schema,
    async call(method, path, opts = {}) {
      const res = await fetch(baseUrl + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : undefined };
    },
    async project() {
      const project = await createProject(`p${++n}`);
      const { key } = await createApiKey('test', project.id);
      return { projectId: project.id, key };
    },
    async login() {
      const username = `u${++n}`;
      const user = await createUser(username, 'password1');
      const { token } = await createSession(user.id);
      return { userId: user.id, token, username };
    },
    async stop() {
      await new Promise((r) => server.close(r));
      await pool.end();
      const admin = new Client({ connectionString: ADMIN_URL });
      await admin.connect();
      await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      await admin.end();
    },
  };
}

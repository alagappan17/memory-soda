import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CONFIG = fileURLToPath(new URL('./config.ts', import.meta.url));

/**
 * `config.ts` parses at import and caches, so each case runs in its own process
 * with a purpose-built environment.
 */
function load(env: Record<string, string | undefined>) {
  const clean = Object.fromEntries(
    Object.entries({ ...process.env, ...env }).filter(
      ([, v]) => v !== undefined,
    ),
  ) as Record<string, string>;

  return execFileSync(
    process.execPath,
    [
      '-e',
      `import(${JSON.stringify(CONFIG)}).then(m => console.log(JSON.stringify(m.config)))`,
    ],
    { env: clean, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  );
}

function loadError(env: Record<string, string | undefined>): string {
  try {
    load(env);
    assert.fail('expected the config to reject this environment');
  } catch (err) {
    return String((err as { stderr?: string }).stderr ?? err);
  }
}

const REQUIRED = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
  GOOGLE_GENERATIVE_AI_API_KEY: 'test-key',
};

/** Env vars that would otherwise leak in from the developer's own shell. */
const CLEARED = {
  HOST: undefined,
  PORT: undefined,
  CORS_ORIGIN: undefined,
  MIGRATE_ON_START: undefined,
  GEMINI_MODEL: undefined,
  GEMINI_TIMEOUT_MS: undefined,
  GEMINI_STRUCTURED_TIMEOUT_MS: undefined,
  GEMINI_EMBED_MODEL: undefined,
  GEMINI_EMBED_DIM: undefined,
  GEMINI_API_BASE_URL: undefined,
};

test('defaults match the values that were previously hard-coded', () => {
  const c = JSON.parse(load({ ...CLEARED, ...REQUIRED }));

  assert.equal(c.server.host, 'localhost');
  assert.equal(c.server.port, 3004);
  assert.deepEqual(c.server.corsOrigins, ['http://localhost:3000']);
  assert.equal(c.server.migrateOnStart, true);

  assert.equal(c.gemini.model, 'gemini-2.5-flash');
  assert.equal(c.gemini.timeoutMs, 30_000);
  assert.equal(c.gemini.structuredTimeoutMs, 90_000);
  assert.equal(c.gemini.embedModel, 'models/gemini-embedding-001');
  assert.equal(c.gemini.embedDim, 768);
  assert.equal(
    c.gemini.embedUrl,
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001',
    'the derived URL must equal the literal it replaced',
  );
});

test('the embedding URL follows the model, and tolerates a trailing slash', () => {
  const swapped = JSON.parse(
    load({
      ...CLEARED,
      ...REQUIRED,
      GEMINI_EMBED_MODEL: 'models/text-embedding-004',
    }),
  );
  assert.equal(
    swapped.gemini.embedUrl,
    'https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004',
    'changing the model must not leave the URL on the previous one',
  );

  const proxied = JSON.parse(
    load({
      ...CLEARED,
      ...REQUIRED,
      GEMINI_API_BASE_URL: 'https://gw.internal/v1beta/',
    }),
  );
  assert.equal(
    proxied.gemini.embedUrl,
    'https://gw.internal/v1beta/models/gemini-embedding-001',
  );
});

test('CORS_ORIGIN is split and trimmed', () => {
  const c = JSON.parse(
    load({
      ...CLEARED,
      ...REQUIRED,
      CORS_ORIGIN: 'https://a.com, https://b.com ',
    }),
  );
  assert.deepEqual(c.server.corsOrigins, ['https://a.com', 'https://b.com']);
});

test('MIGRATE_ON_START accepts true/false and 1/0', () => {
  for (const [raw, expected] of [
    ['false', false],
    ['0', false],
    ['true', true],
    ['1', true],
  ] as const) {
    const c = JSON.parse(
      load({ ...CLEARED, ...REQUIRED, MIGRATE_ON_START: raw }),
    );
    assert.equal(c.server.migrateOnStart, expected, `MIGRATE_ON_START=${raw}`);
  }
});

test('every missing required variable is reported at once', () => {
  const err = loadError({
    ...CLEARED,
    DATABASE_URL: undefined,
    GOOGLE_GENERATIVE_AI_API_KEY: undefined,
  });
  assert.match(err, /DATABASE_URL is required/);
  assert.match(err, /GOOGLE_GENERATIVE_AI_API_KEY is required/);
});

test('a malformed number fails the boot rather than silently defaulting', () => {
  const err = loadError({
    ...CLEARED,
    ...REQUIRED,
    PORT: 'not-a-port',
    GEMINI_TIMEOUT_MS: 'soon',
  });
  assert.match(err, /PORT/);
  assert.match(err, /GEMINI_TIMEOUT_MS/);
});

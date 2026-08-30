import { DEFAULT_ADMIN_PASSWORD } from '@memory-soda/types';
import { z } from 'zod';

/**
 * The single place environment variables are read.
 *
 * Everything is parsed once, at import, so a misconfigured deployment fails on
 * boot with every problem listed at once rather than surfacing one variable at
 * a time, or, worse, silently running with a default the operator did not
 * intend. Nothing else in `apps/api` should touch `process.env`.
 *
 * Note this deliberately does not cover `packages/sdk` (its `fromEnv()` reads
 * the consumer's environment, not ours) or the dashboard (Vite inlines
 * `import.meta.env` at build time).
 */

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .transform((v) => v === 'true' || v === '1')
    .default(fallback ? 'true' : 'false');

const schema = z.object({
  // ── Server ────────────────────────────────────────────────────────────────
  HOST: z.string().min(1).default('localhost'),
  PORT: z.coerce.number().int().positive().max(65535).default(3004),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:3000'),
  MIGRATE_ON_START: bool(true),

  // ── Database ──────────────────────────────────────────────────────────────
  DATABASE_URL: z
    .string({ required_error: 'DATABASE_URL is required' })
    .min(1, 'DATABASE_URL is required'),

  // ── Gemini ────────────────────────────────────────────────────────────────
  GOOGLE_GENERATIVE_AI_API_KEY: z
    .string({ required_error: 'GOOGLE_GENERATIVE_AI_API_KEY is required' })
    .min(1, 'GOOGLE_GENERATIVE_AI_API_KEY is required'),
  GEMINI_MODEL: z.string().min(1).default('gemini-2.5-flash'),
  GEMINI_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  GEMINI_STRUCTURED_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(90_000),
  GEMINI_EMBED_MODEL: z.string().min(1).default('models/gemini-embedding-001'),
  GEMINI_EMBED_DIM: z.coerce.number().int().positive().default(768),
  GEMINI_API_BASE_URL: z
    .string()
    .url()
    .default('https://generativelanguage.googleapis.com/v1beta'),

  // ── First-boot admin ──────────────────────────────────────────────────────
  ADMIN_USERNAME: z.string().min(1).default('admin'),
  ADMIN_PASSWORD: z.string().min(1).default(DEFAULT_ADMIN_PASSWORD),
});

function load(): z.infer<typeof schema> {
  const parsed = schema.safeParse(process.env);
  if (parsed.success) return parsed.data;

  const problems = parsed.error.issues
    .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  throw new Error(
    `Invalid environment configuration:\n${problems}\n\n` +
      'See .env.example for the full list of supported variables.',
  );
}

const env = load();

/**
 * The pgvector columns are declared `vector(768)`, so a different embedding
 * size is rejected on insert. This is a warning rather than a hard failure
 * because the schema may legitimately have been migrated to match.
 */
const SCHEMA_EMBED_DIM = 768;
if (env.GEMINI_EMBED_DIM !== SCHEMA_EMBED_DIM) {
  console.warn(
    `[config] GEMINI_EMBED_DIM=${env.GEMINI_EMBED_DIM} does not match the ` +
      `vector(${SCHEMA_EMBED_DIM}) columns in the database, embedding writes ` +
      'will fail unless the schema has been migrated to match.',
  );
}

export const config = Object.freeze({
  server: Object.freeze({
    host: env.HOST,
    port: env.PORT,
    /** Comma-separated in the environment; always an array here. */
    corsOrigins: Object.freeze(
      env.CORS_ORIGIN.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
    migrateOnStart: env.MIGRATE_ON_START,
  }),

  db: Object.freeze({
    url: env.DATABASE_URL,
  }),

  gemini: Object.freeze({
    apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY,
    model: env.GEMINI_MODEL,
    timeoutMs: env.GEMINI_TIMEOUT_MS,
    /**
     * Structured calls run in background jobs, not on a request path, so they
     * allow for the model's thinking-mode tail latency.
     */
    structuredTimeoutMs: env.GEMINI_STRUCTURED_TIMEOUT_MS,
    embedModel: env.GEMINI_EMBED_MODEL,
    embedDim: env.GEMINI_EMBED_DIM,
    /**
     * Derived rather than configured separately, so changing the embedding
     * model can never leave the URL pointing at the previous one.
     */
    embedUrl: `${env.GEMINI_API_BASE_URL.replace(/\/+$/, '')}/${env.GEMINI_EMBED_MODEL.replace(/^\/+/, '')}`,
  }),

  admin: Object.freeze({
    username: env.ADMIN_USERNAME,
    password: env.ADMIN_PASSWORD,
  }),
});

export type Config = typeof config;

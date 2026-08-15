import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  index,
  uniqueIndex,
  integer,
  boolean,
  real,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { customType } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// pgvector custom column type
const vector = customType<{ data: number[]; driverData: string }>({
  dataType(config) {
    const dimensions =
      (config as { dimensions?: number } | undefined)?.dimensions ?? 768;
    return `vector(${dimensions})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    return value.slice(1, -1).split(',').map(Number);
  },
});

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  settings: jsonb('settings'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export type ProjectRow = typeof projects.$inferSelect;
export type NewProjectRow = typeof projects.$inferInsert;

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  key: text('key').notNull().unique(),
  keyPreview: text('key_preview').notNull(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at'),
  revokedAt: timestamp('revoked_at'),
});

export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type NewApiKeyRow = typeof apiKeys.$inferInsert;

export const projectsRelations = relations(projects, ({ many }) => ({
  apiKeys: many(apiKeys),
}));

export const apiKeysRelations = relations(apiKeys, ({ one, many }) => ({
  project: one(projects, {
    fields: [apiKeys.projectId],
    references: [projects.id],
  }),
  threads: many(threads),
}));

// Dashboard login users. Single role for now (no permissions).
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').notNull().unique(),
  // Stored as "salt:scryptHex" — never plaintext.
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;

// Server-side, revocable login sessions (opaque bearer tokens).
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // SHA-256 hash of the plaintext session token; plaintext shown once at login.
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

// ── Working Memory ───────────────────────────────────────────────────────────

export const messageRoleEnum = pgEnum('message_role', [
  'user',
  'assistant',
  'system',
  'tool',
]);

export const threads = pgTable(
  'threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dataset: text('dataset').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    tags: text('tags').array().notNull().default([]),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    autoCompactThreshold: integer('auto_compact_threshold'),
    episodicSettings: jsonb('episodic_settings'),
    semanticSettings: jsonb('semantic_settings'),
    lastCompactedAt: timestamp('last_compacted_at', { withTimezone: true }),
    lastCompactedSequence: integer('last_compacted_sequence')
      .notNull()
      .default(0),
  },
  (t) => [
    index('threads_activity_idx').on(t.lastActivityAt),
    index('threads_project_idx').on(t.projectId),
  ],
);

export type ThreadRow = typeof threads.$inferSelect;
export type NewThreadRow = typeof threads.$inferInsert;

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    role: messageRoleEnum('role').notNull(),
    content: text('content').notNull(),
    sequenceNumber: integer('sequence_number').notNull(),
    tokens: jsonb('tokens'),
    model: text('model'),
    latencyMs: integer('latency_ms'),
    metadata: jsonb('metadata'),
    compactedAt: timestamp('compacted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('messages_thread_seq_idx').on(t.threadId, t.sequenceNumber),
    index('messages_thread_time_idx').on(t.threadId, sql`${t.createdAt} DESC`),
    index('messages_thread_compacted_idx').on(t.threadId, t.compactedAt),
  ],
);

export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;

export const threadsRelations = relations(threads, ({ many }) => ({
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  thread: one(threads, {
    fields: [messages.threadId],
    references: [threads.id],
  }),
}));

// ── Episodic Memory ───────────────────────────────────────────────────────────

export const episodeStatusEnum = pgEnum('episode_status', [
  'pending',
  'processing',
  'completed',
  'failed',
  'deleted',
  'archived',
]);

// Drives the async semantic-extraction pipeline, advanced independently of `status`.
export const semanticStatusEnum = pgEnum('semantic_status', [
  'pending',
  'processing',
  'completed',
  'failed',
  'skipped',
]);

export const episodes = pgTable(
  'episodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: uuid('thread_id').references(() => threads.id),
    dataset: text('dataset').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    status: episodeStatusEnum('status').notNull().default('pending'),
    semanticStatus: semanticStatusEnum('semantic_status')
      .notNull()
      .default('pending'),
    summary: text('summary'),
    keyLearnings: jsonb('key_learnings'),
    embedding: vector('embedding', { dimensions: 768 }),
    messageCount: integer('message_count').notNull().default(0),
    tokenCount: integer('token_count'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    processingStartedAt: timestamp('processing_started_at', {
      withTimezone: true,
    }),
    processingCompletedAt: timestamp('processing_completed_at', {
      withTimezone: true,
    }),
    error: text('error'),
    retryCount: integer('retry_count').notNull().default(0),
    semanticRetryCount: integer('semantic_retry_count').notNull().default(0),
    // Message range (inclusive sequence numbers) this episode covers. NULL on
    // legacy episodes → extraction falls back to the whole uncompacted thread.
    startSequence: integer('start_sequence'),
    endSequence: integer('end_sequence'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('episodes_dataset_project_status_idx').on(
      t.dataset,
      t.projectId,
      t.status,
    ),
    index('episodes_dataset_created_idx').on(t.dataset, t.createdAt),
    index('episodes_thread_idx').on(t.threadId),
    index('episodes_status_created_idx').on(t.status, t.createdAt),
  ],
);

export type EpisodeRow = typeof episodes.$inferSelect;
export type NewEpisodeRow = typeof episodes.$inferInsert;

export const episodesRelations = relations(episodes, ({ one }) => ({
  thread: one(threads, {
    fields: [episodes.threadId],
    references: [threads.id],
  }),
}));

export const scheduledEpisodes = pgTable(
  'scheduled_episodes',
  {
    threadId: uuid('thread_id')
      .primaryKey()
      .references(() => threads.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    fireAt: timestamp('fire_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('scheduled_episodes_fire_at_idx').on(t.fireAt)],
);

export type ScheduledEpisodeRow = typeof scheduledEpisodes.$inferSelect;

// ── Semantic Memory ───────────────────────────────────────────────────────────
//
// A single `facts` table holds both literal facts (objectIsEntity=false, e.g.
// "user likes mango sticky rice") and entity↔entity relationships
// (objectIsEntity=true, e.g. "user works_at memory-soda"). This keeps
// multi-hop traversal possible later (recursive CTE over objectIsEntity rows)
// without a second store.
//
// Bi-temporal semantics:
//   valid time  — `validAt` → `validUntil`: when the fact is true in the world.
//     `validUntil` may be in the future ("running daily for six months") or the
//     past (a stated historical fact).
//   belief time — `createdAt` → `invalidAt`: `invalidAt` means superseded by a
//     contradiction or soft-deleted, ONLY. Never a stated end of validity.
//
// The fact's anchor entity is derived, not stored: object when objectIsEntity,
// else subject.
//
// Specialised indexes — the ivfflat cosine index on `embedding` and the
// expression GIN index for keyword search — are hand-added in the migration SQL
// (drizzle-kit does not emit them from the `vector` customType), mirroring
// `episodes_embedding_idx`.

export const facts = pgTable(
  'facts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dataset: text('dataset').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    subject: text('subject').notNull(),
    predicate: text('predicate').notNull(),
    object: text('object').notNull(),
    objectIsEntity: boolean('object_is_entity').notNull().default(false),
    /**
     * Model-rated extraction confidence (0–1). Facts are stored regardless of
     * confidence; retrieval filters by the project's retrievalMinConfidence.
     */
    confidence: real('confidence').notNull().default(1),
    /** Verbatim supporting quote from the source transcript (provenance). */
    sourceQuote: text('source_quote'),
    episodeId: uuid('episode_id').references(() => episodes.id, {
      onDelete: 'set null',
    }),
    validAt: timestamp('valid_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    validUntil: timestamp('valid_until', { withTimezone: true }),
    invalidAt: timestamp('invalid_at', { withTimezone: true }),
    embedding: vector('embedding', { dimensions: 768 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('facts_dataset_project_invalid_idx').on(
      t.dataset,
      t.projectId,
      t.invalidAt,
    ),
    index('facts_dataset_project_subject_idx').on(
      t.dataset,
      t.projectId,
      t.subject,
    ),
    index('facts_episode_idx').on(t.episodeId),
    // Entity-anchor retrieval also matches on `object`.
    index('facts_dataset_project_object_idx').on(
      t.dataset,
      t.projectId,
      t.object,
    ),
    // No-query fallback: live facts ordered by recency.
    index('facts_dataset_project_recency_idx')
      .on(t.dataset, t.projectId, t.validAt)
      .where(sql`${t.invalidAt} IS NULL`),
    // Backstop against duplicate live facts across concurrent episode jobs.
    // `valid_until` (coalesced to 'infinity') is part of the key so an expired
    // fact (invalid_at still NULL, but its valid-time window has ended) doesn't
    // block inserting a new one for the same subject/predicate/object.
    uniqueIndex('facts_live_exact_idx')
      .on(
        t.dataset,
        t.projectId,
        t.subject,
        t.predicate,
        t.object,
        sql`coalesce(${t.validUntil}, 'infinity'::timestamp with time zone)`,
      )
      .where(sql`${t.invalidAt} IS NULL`),
  ],
);

export type FactRow = typeof facts.$inferSelect;
export type NewFactRow = typeof facts.$inferInsert;

/**
 * SQL predicate for a "live" (currently-true) fact: not superseded/deleted AND
 * its stated valid-time window (if any) has not ended. Use this everywhere we
 * mean "currently true" instead of a bare `invalid_at IS NULL`. NOTE: `now()` is
 * non-immutable, so the valid_until clause cannot be pushed into the partial
 * indexes (`facts_live_exact_idx`, `facts_dataset_project_recency_idx`), which are
 * keyed on `invalid_at IS NULL` and therefore cover a superset of live rows.
 */
export const isLiveFact = sql`(${facts.invalidAt} IS NULL AND ${facts.validAt} <= now() AND (${facts.validUntil} IS NULL OR ${facts.validUntil} > now()))`;

/**
 * Point-in-time variant of {@link isLiveFact}: was the fact believed true at
 * `asOf`? True when the valid-time window covered `asOf`, the row had not
 * been superseded/deleted by then, and the row actually existed by `asOf`.
 */
export const isLiveFactAsOf = (asOf: Date) =>
  sql`(${facts.createdAt} <= ${asOf} AND ${facts.validAt} <= ${asOf} AND (${facts.validUntil} IS NULL OR ${facts.validUntil} > ${asOf}) AND (${facts.invalidAt} IS NULL OR ${facts.invalidAt} > ${asOf}))`;

export const entities = pgTable(
  'entities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dataset: text('dataset').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type').notNull(),
    embedding: vector('embedding', { dimensions: 768 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('entities_dataset_project_name_idx').on(
      t.dataset,
      t.projectId,
      t.name,
    ),
  ],
);

export type EntityRow = typeof entities.$inferSelect;
export type NewEntityRow = typeof entities.$inferInsert;

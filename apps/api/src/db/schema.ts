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

export const memories = pgTable(
  'memories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    content: text('content').notNull(),
    source: text('source').notNull().default('USER'),
    metadata: jsonb('metadata').notNull().default({}),
    embedding: vector('embedding', { dimensions: 3072 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('memories_user_id_idx').on(t.userId)],
);

export type MemoryRow = typeof memories.$inferSelect;
export type NewMemoryRow = typeof memories.$inferInsert;

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
    userId: text('user_id').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    tags: text('tags').array().notNull().default([]),
    metadata: jsonb('metadata'),
    messageCount: integer('message_count').notNull().default(0),
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
    tokenCount: jsonb('token_count'),
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
    userId: text('user_id').notNull(),
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
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('episodes_user_project_status_idx').on(
      t.userId,
      t.projectId,
      t.status,
    ),
    index('episodes_user_created_idx').on(t.userId, t.createdAt),
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
// "Alagappan likes mango sticky rice") and entity↔entity relationships
// (objectIsEntity=true, e.g. "Alagappan works_at memory-soda"). This keeps
// multi-hop traversal possible later (recursive CTE over objectIsEntity rows)
// without a second store. `invalidAt IS NULL` means the fact is currently true;
// contradictions are resolved by stamping `invalidAt` on the superseded row.
//
// Specialised indexes — the ivfflat cosine index on `embedding` and the
// expression GIN index for keyword search — are hand-added in the migration SQL
// (drizzle-kit does not emit them from the `vector` customType), mirroring
// `episodes_embedding_idx`.

export const facts = pgTable(
  'facts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    subject: text('subject').notNull(),
    predicate: text('predicate').notNull(),
    object: text('object').notNull(),
    objectIsEntity: boolean('object_is_entity').notNull().default(false),
    contextEntityName: text('context_entity_name'),
    confidence: real('confidence').notNull().default(1),
    episodeId: uuid('episode_id').references(() => episodes.id, {
      onDelete: 'set null',
    }),
    validAt: timestamp('valid_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    ingestionAt: timestamp('ingestion_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
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
    index('facts_user_project_invalid_idx').on(
      t.userId,
      t.projectId,
      t.invalidAt,
    ),
    index('facts_user_project_subject_idx').on(
      t.userId,
      t.projectId,
      t.subject,
    ),
    index('facts_user_project_context_idx').on(
      t.userId,
      t.projectId,
      t.contextEntityName,
    ),
    index('facts_episode_idx').on(t.episodeId),
  ],
);

export type FactRow = typeof facts.$inferSelect;
export type NewFactRow = typeof facts.$inferInsert;

export const entities = pgTable(
  'entities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type').notNull(),
    attributes: jsonb('attributes').notNull().default({}),
    embedding: vector('embedding', { dimensions: 768 }),
    factCount: integer('fact_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('entities_user_project_name_idx').on(
      t.userId,
      t.projectId,
      t.name,
    ),
  ],
);

export type EntityRow = typeof entities.$inferSelect;
export type NewEntityRow = typeof entities.$inferInsert;

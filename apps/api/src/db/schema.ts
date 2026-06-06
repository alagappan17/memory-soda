import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  index,
  uniqueIndex,
  integer,
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
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [index('memories_user_id_idx').on(t.userId)],
);

export type MemoryRow = typeof memories.$inferSelect;
export type NewMemoryRow = typeof memories.$inferInsert;

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export type ProjectRow = typeof projects.$inferSelect;
export type NewProjectRow = typeof projects.$inferInsert;

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  key: text('key').notNull().unique(),
  keyPreview: text('key_preview').notNull(),
  projectId: uuid('project_id').references(() => projects.id, {
    onDelete: 'cascade',
  }),
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
    apiKeyId: uuid('api_key_id')
      .notNull()
      .references(() => apiKeys.id, { onDelete: 'cascade' }),
    tags: text('tags').array().notNull().default([]),
    metadata: jsonb('metadata'),
    messageCount: integer('message_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    autoCompactThreshold: integer('auto_compact_threshold'),
    lastCompactedAt: timestamp('last_compacted_at', { withTimezone: true }),
    lastCompactedSequence: integer('last_compacted_sequence').notNull().default(0),
  },
  (t) => [index('threads_activity_idx').on(t.lastActivityAt)],
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

export const threadsRelations = relations(threads, ({ one, many }) => ({
  apiKey: one(apiKeys, {
    fields: [threads.apiKeyId],
    references: [apiKeys.id],
  }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  thread: one(threads, {
    fields: [messages.threadId],
    references: [threads.id],
  }),
}));

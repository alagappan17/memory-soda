import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/postgres.js';
import { entities, episodes, facts, messages, threads } from '../db/schema.js';
import type { DatasetDeletion, DatasetExport } from '@memory-soda/types';

/**
 * Dataset-level operations: read everything, or forget everything.
 *
 * A dataset is the unit a person maps onto, so it is the unit that has to be
 * exportable and erasable. Both run against the project the caller is scoped
 * to, so one project can never read or erase another's memory.
 */

export async function exportDataset(
  dataset: string,
  projectId: string,
): Promise<DatasetExport> {
  const threadRows = await db
    .select({
      id: threads.id,
      tags: threads.tags,
      createdAt: threads.createdAt,
    })
    .from(threads)
    .where(and(eq(threads.dataset, dataset), eq(threads.projectId, projectId)))
    .orderBy(asc(threads.createdAt));

  const threadIds = threadRows.map((t) => t.id);
  const messageRows =
    threadIds.length > 0
      ? await db
          .select({
            threadId: messages.threadId,
            role: messages.role,
            content: messages.content,
            createdAt: messages.createdAt,
          })
          .from(messages)
          .where(inArray(messages.threadId, threadIds))
          .orderBy(asc(messages.threadId), asc(messages.sequenceNumber))
      : [];

  const messagesByThread = new Map<string, DatasetExport['threads'][number]['messages']>();
  for (const m of messageRows) {
    const list = messagesByThread.get(m.threadId) ?? [];
    list.push({
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    });
    messagesByThread.set(m.threadId, list);
  }

  const [episodeRows, factRows, entityRows] = await Promise.all([
    db
      .select({
        id: episodes.id,
        summary: episodes.summary,
        keyLearnings: episodes.keyLearnings,
        startedAt: episodes.startedAt,
        endedAt: episodes.endedAt,
      })
      .from(episodes)
      .where(and(eq(episodes.dataset, dataset), eq(episodes.projectId, projectId)))
      .orderBy(desc(episodes.createdAt)),
    db
      .select({
        id: facts.id,
        subject: facts.subject,
        predicate: facts.predicate,
        object: facts.object,
        confidence: facts.confidence,
        sourceQuote: facts.sourceQuote,
        validAt: facts.validAt,
        validUntil: facts.validUntil,
        invalidAt: facts.invalidAt,
      })
      .from(facts)
      .where(and(eq(facts.dataset, dataset), eq(facts.projectId, projectId)))
      .orderBy(desc(facts.validAt)),
    db
      .select({ name: entities.name, type: entities.type })
      .from(entities)
      .where(and(eq(entities.dataset, dataset), eq(entities.projectId, projectId)))
      .orderBy(asc(entities.name)),
  ]);

  return {
    dataset,
    exportedAt: new Date().toISOString(),
    threads: threadRows.map((t) => ({
      threadId: t.id,
      tags: t.tags,
      createdAt: t.createdAt.toISOString(),
      messages: messagesByThread.get(t.id) ?? [],
    })),
    episodes: episodeRows.map((e) => ({
      episodeId: e.id,
      summary: e.summary,
      keyLearnings: e.keyLearnings,
      startedAt: e.startedAt?.toISOString() ?? null,
      endedAt: e.endedAt?.toISOString() ?? null,
    })),
    facts: factRows.map((f) => ({
      factId: f.id,
      subject: f.subject,
      predicate: f.predicate,
      object: f.object,
      confidence: f.confidence,
      sourceQuote: f.sourceQuote,
      validAt: f.validAt.toISOString(),
      validUntil: f.validUntil?.toISOString() ?? null,
      invalidAt: f.invalidAt?.toISOString() ?? null,
    })),
    entities: entityRows,
  };
}

/**
 * Erase a dataset. Hard deletes, not the soft `invalidAt` stamp used for
 * curation — "forget me" has to actually remove the rows.
 *
 * One transaction so a partial erase is impossible. Messages and scheduled
 * episodes go with their threads via ON DELETE CASCADE; facts reference
 * episodes with ON DELETE SET NULL, so they are removed explicitly first.
 */
export async function deleteDataset(
  dataset: string,
  projectId: string,
): Promise<DatasetDeletion> {
  return db.transaction(async (tx) => {
    const removedFacts = await tx
      .delete(facts)
      .where(and(eq(facts.dataset, dataset), eq(facts.projectId, projectId)))
      .returning({ id: facts.id });
    const removedEntities = await tx
      .delete(entities)
      .where(and(eq(entities.dataset, dataset), eq(entities.projectId, projectId)))
      .returning({ id: entities.id });
    const removedEpisodes = await tx
      .delete(episodes)
      .where(and(eq(episodes.dataset, dataset), eq(episodes.projectId, projectId)))
      .returning({ id: episodes.id });
    const removedThreads = await tx
      .delete(threads)
      .where(and(eq(threads.dataset, dataset), eq(threads.projectId, projectId)))
      .returning({ id: threads.id });

    return {
      dataset,
      deleted: {
        threads: removedThreads.length,
        episodes: removedEpisodes.length,
        facts: removedFacts.length,
        entities: removedEntities.length,
      },
    };
  });
}

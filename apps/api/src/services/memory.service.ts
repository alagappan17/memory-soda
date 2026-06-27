import { eq, and, desc, asc, sql, isNull } from 'drizzle-orm';
import { db } from '../db/postgres.js';
import { threads, messages } from '../db/schema.js';
import { getEpisodicContext } from './episodic-memory.service.js';
import { getProjectSettings } from './project-settings.service.js';
import { getSemanticContext } from './semantic-memory.service.js';
import type {
  EpisodeContext,
  ProjectEpisodicSettings,
  ProjectSemanticSettings,
  ProjectSettings,
  ProjectWorkingSettings,
  SemanticContext,
} from '@memory-soda/types';

const notSummarySql = sql`(${messages.metadata}->>'type' IS NULL OR ${messages.metadata}->>'type' != 'compact_summary')`;
const isSummarySql = sql`${messages.metadata}->>'type' = 'compact_summary'`;

export interface PrepareResult {
  threadId: string;
  messages: { role: string; content: string }[];
  episodes: EpisodeContext | null;
  facts: SemanticContext | null;
  messageCount: number;
  truncated: boolean;
  compacted: boolean;
  warning?: string;
}

export async function prepareThread(
  threadId: string,
  projectId: string,
  messageLimit: number | undefined,
  query?: string,
): Promise<PrepareResult | null> {
  const [threadRow] = await db
    .select({
      id: threads.id,
      userId: threads.userId,
      episodicSettings: threads.episodicSettings,
      semanticSettings: threads.semanticSettings,
      workingSettings: threads.workingSettings,
      autoCompactThreshold: threads.autoCompactThreshold,
    })
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.projectId, projectId)));
  if (!threadRow) return null;

  // Project settings are fetched at most once, and only when a thread is missing
  // its own frozen settings (legacy threads created before per-thread freezing).
  let projectSettingsCache: ProjectSettings | null = null;
  const projectSettings = async (): Promise<ProjectSettings> =>
    (projectSettingsCache ??= await getProjectSettings(projectId));

  const working: ProjectWorkingSettings =
    (threadRow.workingSettings as ProjectWorkingSettings | null) ??
    (await projectSettings()).working;
  const effectiveLimit = messageLimit ?? working.messageLimit;

  // The active compact summary is always included first and never counts
  // against messageLimit — shrinking the limit can't drop compacted context.
  const fetchMessages = async () => {
    const realMsgWhere = and(
      eq(messages.threadId, threadId),
      isNull(messages.compactedAt),
      notSummarySql,
    );
    const [summaryRows, [totalRow], realRows] = await Promise.all([
      db
        .select({ role: messages.role, content: messages.content })
        .from(messages)
        .where(
          and(
            eq(messages.threadId, threadId),
            isNull(messages.compactedAt),
            isSummarySql,
          ),
        )
        .orderBy(asc(messages.sequenceNumber)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(messages)
        .where(realMsgWhere),
      db
        .select({ role: messages.role, content: messages.content })
        .from(messages)
        .where(realMsgWhere)
        .orderBy(desc(messages.sequenceNumber))
        .limit(effectiveLimit),
    ]);
    const realCount = totalRow?.count ?? 0;
    realRows.reverse();
    return { summaryRows, realRows, realCount };
  };

  const fetchEpisodes = async (): Promise<EpisodeContext | null> => {
    try {
      const settings: ProjectEpisodicSettings =
        (threadRow.episodicSettings as ProjectEpisodicSettings | null) ??
        (await projectSettings()).episodic;
      if (!settings.enabled) return null;
      return await getEpisodicContext(
        threadRow.userId,
        projectId,
        query,
        settings.episodesInContext,
        settings.recencyWeight,
      );
    } catch {
      return null;
    }
  };

  const fetchFacts = async (): Promise<SemanticContext | null> => {
    try {
      const semanticSettings: ProjectSemanticSettings =
        (threadRow.semanticSettings as ProjectSemanticSettings | null) ??
        (await projectSettings()).semantic;
      if (!semanticSettings.enabled) return null;
      const result = await getSemanticContext(
        threadRow.userId,
        projectId,
        query,
        semanticSettings.factsInContext,
      );
      console.log('[semantic] fetchFacts result:', { factCount: result.factCount, relCount: result.relationshipCount, userId: threadRow.userId, projectId, query });
      return result.factCount > 0 || result.relationshipCount > 0 ? result : null;
    } catch (err) {
      console.error('[semantic] fetchFacts threw:', err);
      return null;
    }
  };

  const [{ summaryRows, realRows, realCount }, episodes, facts] =
    await Promise.all([fetchMessages(), fetchEpisodes(), fetchFacts()]);

  const threshold = working.autoCompactThreshold ?? threadRow.autoCompactThreshold ?? null;
  const warning =
    threshold !== null && effectiveLimit < threshold
      ? `messageLimit (${effectiveLimit}) is less than autoCompactThreshold (${threshold}). Messages between the compact summary and the retrieved tail may be missing. Set messageLimit >= autoCompactThreshold to ensure full context.`
      : undefined;

  return {
    threadId,
    messages: [...summaryRows, ...realRows],
    episodes,
    facts,
    messageCount: realCount,
    truncated: realCount > effectiveLimit,
    compacted: summaryRows.length > 0,
    warning,
  };
}

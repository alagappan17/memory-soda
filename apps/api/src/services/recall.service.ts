import { embedText, synthesizeContext } from '../lib/gemini.js';
import {
  getEpisodicContext,
  getProjectEpisodicSettings,
} from './episodic-memory.service.js';
import {
  getSemanticContext,
  getEffectiveSemanticSettings,
  querySemanticFacts,
  assembleContext,
  renderContext,
  getEntitiesByName,
} from './semantic-memory.service.js';
import type {
  EpisodeContext,
  RecallRequest,
  RecallResponse,
  SemanticFact,
} from '@memory-soda/types';

/**
 * Long-term memory retrieval for a dataset — the read-side counterpart to the
 * async extraction pipeline. Thread-free by design: callers personalize any
 * request (chat turn, search page, agent tool) with just a dataset key.
 *
 * Facts always drive the rendered `context`; episodes / synthesis / raw are
 * opt-in extras. The query is embedded once and shared by fact and episode
 * retrieval. `asOf` switches fact retrieval to point-in-time.
 */
export async function recall(
  projectId: string,
  req: RecallRequest,
): Promise<RecallResponse> {
  const { dataset, query, include = [], limit, asOf, minConfidence } = req;

  console.log(
    `[recall] ── request ── project=${projectId}\n` +
      JSON.stringify(
        { dataset, query, include, limit, asOf, minConfidence },
        null,
        2,
      ),
  );

  const settings = await getEffectiveSemanticSettings(projectId);
  const factLimit = limit ?? settings.factsInContext;
  const confidenceFloor = minConfidence ?? settings.retrievalMinConfidence;

  // Embed the query once (best-effort — retrieval falls back to keyword/recency).
  let queryEmbedding: number[] | null = null;
  if (query && query.trim().length >= 3) {
    try {
      queryEmbedding = await embedText(query);
    } catch (err) {
      console.warn('[recall] query embed failed — falling back to keyword/recency:', err);
    }
  }

  const fetchFacts = async (): Promise<SemanticFact[]> => {
    if (!settings.enabled) return [];
    try {
      if (asOf) {
        // Point-in-time recall: liveness evaluated at `asOf` (keyword/recency
        // retrieval — hybrid retrieval assumes the current live set).
        const { facts } = await querySemanticFacts(dataset, projectId, {
          q: query,
          limit: factLimit,
          asOf: new Date(asOf),
          minConfidence: confidenceFloor,
        });
        return facts;
      }
      const ctx = await getSemanticContext(
        dataset,
        projectId,
        query,
        factLimit,
        queryEmbedding,
        {
          minConfidence: confidenceFloor,
          anchorVectorMin: settings.anchorVectorMin,
          anchorVectorTopK: settings.anchorVectorTopK,
        },
      );
      return ctx.facts;
    } catch (err) {
      console.error('[recall] semantic fetch failed:', err);
      return [];
    }
  };

  const fetchEpisodes = async (): Promise<EpisodeContext | null> => {
    if (!include.includes('episodes')) return null;
    try {
      const episodic = await getProjectEpisodicSettings(projectId);
      if (!episodic.enabled) return null;
      return await getEpisodicContext(
        dataset,
        projectId,
        query,
        episodic.contextEpisodes,
        episodic.similarityWeight,
        episodic.recencyWeight,
        queryEmbedding,
      );
    } catch {
      return null;
    }
  };

  const [factList, episodes] = await Promise.all([
    fetchFacts(),
    fetchEpisodes(),
  ]);

  const groups = assembleContext(factList);
  const entityList = await getEntitiesByName(
    dataset,
    projectId,
    groups.map((g) => g.entityName),
  );
  const context = renderContext(groups, entityList);

  let synthesis: string | null = null;
  if (include.includes('synthesis') && context.length > 0) {
    try {
      synthesis = await synthesizeContext(context);
    } catch (err) {
      console.error('[recall] synthesis failed:', err);
    }
  }

  const result: RecallResponse = {
    context,
    synthesis,
    facts: include.includes('raw') ? factList : null,
    groups: include.includes('raw') ? groups : null,
    episodes,
    factCount: factList.length,
  };

  console.log(
    `[recall] ── response ── dataset=${dataset}\n` +
      JSON.stringify(result, null, 2),
  );

  return result;
}

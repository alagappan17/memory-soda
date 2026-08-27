import { and, gte, isNull, lte, type SQL } from 'drizzle-orm';
import { messages } from '../db/schema.js';

/**
 * The messages a given episode covers.
 *
 * Episodes stamp an inclusive `[startSequence, endSequence]` range when they are
 * opened, and both consumers — summarisation and semantic extraction — must read
 * exactly that window or they describe different conversations. Episodes created
 * before the range existed carry NULLs and fall back to the whole uncompacted
 * thread.
 */
export function episodeMessageScope(episode: {
  startSequence: number | null;
  endSequence: number | null;
}): SQL | undefined {
  if (episode.startSequence === null || episode.endSequence === null) {
    return isNull(messages.compactedAt);
  }
  return and(
    gte(messages.sequenceNumber, episode.startSequence),
    lte(messages.sequenceNumber, episode.endSequence),
  );
}

import type {
  RankedContextGroup,
  SemanticEntity,
  SemanticFact,
} from '@memory-soda/types';

/**
 * Pure retrieval and rendering helpers.
 *
 * Deliberately free of any database or config import: this is the logic whose
 * behaviour is worth pinning down in tests, and nothing here needs a running
 * Postgres to be exercised.
 */

/**
 * The entity a fact is anchored to (derived, never stored): the object when it
 * is an entity (user → interested in → asus rog anchors on "asus rog"), else
 * the subject ("user") for literal attributes with no entity to anchor to.
 */
export function anchorFor(f: {
  subject: string;
  object: string;
  objectIsEntity: boolean;
}): string {
  return f.objectIsEntity ? f.object : f.subject;
}

/**
 * Enriched embedding string for a fact. Appending the anchor entity makes it
 * more prominent in vector space, improving entity-centric retrieval.
 */
export function buildFactEmbedString(f: {
  subject: string;
  predicate: string;
  object: string;
  objectIsEntity: boolean;
}): string {
  return `${f.subject} ${f.predicate} ${f.object}. About: ${anchorFor(f)}.`;
}

/** Cosine similarity of two equal-length vectors; 0 when either has no magnitude. */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

/**
 * Reciprocal Rank Fusion across ranked id lists. Higher score = more relevant.
 *
 * `k` damps the contribution of top ranks so one signal ranking an item first
 * cannot outvote two signals ranking it third; 60 is the value the original
 * paper settled on and the one every implementation uses.
 */
export function reciprocalRankFusion(
  lists: string[][],
  k = 60,
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, idx) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + idx + 1));
    });
  }
  return scores;
}

/** Group facts by their derived anchor entity, sorted by relevance. */
export function assembleContext(
  factList: SemanticFact[],
): RankedContextGroup[] {
  const groupMap = new Map<string, RankedContextGroup>();
  for (const fact of factList) {
    const key = anchorFor(fact);
    let group = groupMap.get(key);
    if (!group) {
      group = { entityName: key, facts: [], groupRelevance: 0 };
      groupMap.set(key, group);
    }
    const score = fact.relevanceScore ?? 1;
    group.facts.push({
      subject: fact.subject,
      predicate: fact.predicate,
      object: fact.object,
      sourceQuote: fact.sourceQuote,
      validAt: fact.validAt,
      validUntil: fact.validUntil,
      relevanceScore: score,
    });
    if (score > group.groupRelevance) group.groupRelevance = score;
  }
  const groups = [...groupMap.values()];
  for (const g of groups)
    g.facts.sort((a, b) => b.relevanceScore - a.relevanceScore);
  groups.sort((a, b) => b.groupRelevance - a.groupRelevance);
  return groups;
}

const formatDate = (iso: string) => iso.slice(0, 10);

/** Collapse control characters so fact text can't break out of the rendered block. */
function oneLine(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').trim();
}

/**
 * Render grouped facts into a prompt-ready text block — the primary recall()
 * output. Deterministic, no LLM.
 */
export function renderContext(
  groups: RankedContextGroup[],
  entityList: SemanticEntity[] = [],
): string {
  if (groups.length === 0) return '';

  const lines: string[] = [
    'Known facts about the user, most relevant first.',
    '',
    '# FACTS  (format: fact (valid: from – to))',
  ];
  for (const g of groups) {
    for (const f of g.facts) {
      const until = f.validUntil ? formatDate(f.validUntil) : 'present';
      lines.push(
        `- ${oneLine(f.subject)} ${oneLine(f.predicate)} ${oneLine(f.object)}  (valid: ${formatDate(f.validAt)} – ${until})`,
      );
    }
  }

  if (entityList.length > 0) {
    lines.push('', '# ENTITIES');
    for (const e of entityList) {
      lines.push(`- ${oneLine(e.name)} (${oneLine(e.type)})`);
    }
  }

  return lines.join('\n');
}

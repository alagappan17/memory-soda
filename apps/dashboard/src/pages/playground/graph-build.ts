import type {
  EntityType,
  SemanticEntity,
  SemanticFact,
} from '@memory-soda/types';

export type NodeKind = 'user' | 'entity' | 'value';

export interface GNode {
  id: string;
  label: string;
  kind: NodeKind;
  entityType: EntityType | null;
  /** Facts touching this node; drives node size. */
  degree: number;
  /** Conversation the node clusters with; the user has none. */
  group: string | null;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number;
  fy?: number;
}

/**
 * react-force-graph rewrites `source`/`target` in place from the id string to
 * the node object once the simulation initialises, so both shapes are real.
 */
export interface GLink {
  source: string | GNode;
  target: string | GNode;
  /** Distinct predicates on this edge; several facts on one pair share it. */
  predicates: string[];
  facts: SemanticFact[];
  curvature: number;
}

export interface ConversationHub {
  id: string;
  label: string;
}

/** A conversation's cluster: where its entities are pulled to. */
export interface GCluster extends ConversationHub {
  x: number;
  y: number;
}

export interface BuiltGraph {
  graphData: { nodes: GNode[]; links: GLink[] };
  factsByNode: Map<string, SemanticFact[]>;
  /** Literal facts about the user themselves; listed, not drawn. */
  userFacts: SemanticFact[];
  clusters: GCluster[];
}

export const OTHER_HUB: ConversationHub = { id: 'c:other', label: 'Other' };

/** Distance from the user at which conversation clusters settle. */
const CLUSTER_RADIUS = 420;

export function linkEnd(end: string | GNode): GNode | undefined {
  return typeof end === 'string' ? undefined : end;
}

export function linkEndId(end: string | GNode): string {
  return typeof end === 'string' ? end : end.id;
}

/** Detail leaves are fixed small dots; everything else scales with fact count. */
export function radiusOf(node: GNode): number {
  return node.kind === 'value'
    ? 3.5
    : 6 + 3 * Math.sqrt(Math.min(node.degree, 20));
}

/** Room a node needs in the layout: its circle, or half its label, whichever is wider. */
export function collisionRadius(node: GNode): number {
  const perChar = node.kind === 'value' ? 2.6 : 3.2;
  return Math.max(radiusOf(node), (node.label.length * perChar) / 2 + 10);
}

/**
 * Facts as a force-directed graph, clustered by conversation.
 *
 * The user is the pinned centre; every user → entity fact is a spoke carrying
 * the action (`owns`, `is interested in`). Each entity belongs to the
 * conversation it first came up in, and a cluster force (see the graph tab)
 * pulls it toward that conversation's anchor, spread around the user, so
 * topics settle as separate groups without the conversations being drawn.
 * An entity mentioned in several conversations is pulled between them by its
 * links, which is what joins the groups into one graph. Entity details
 * (`honda civic → has mileage → 120,000 km`) are small leaves beside their
 * entity; the user's own literals have no entity to hang off and come back
 * as `userFacts` for a side list.
 *
 * Pure (no React, no canvas) so it can rebuild without restarting the layout
 * on unrelated UI state changes.
 */
export function buildGraph(
  facts: SemanticFact[],
  entities: SemanticEntity[],
  hubOf: (fact: SemanticFact) => ConversationHub,
): BuiltGraph {
  const entityByName = new Map(entities.map((e) => [e.name.toLowerCase(), e]));
  const nodes = new Map<string, GNode>();
  const links = new Map<string, GLink>();
  const byNode = new Map<string, SemanticFact[]>();
  const userFacts: SemanticFact[] = [];
  const groups = new Map<string, { hub: ConversationHub; size: number }>();

  const record = (id: string, fact: SemanticFact) => {
    const list = byNode.get(id);
    if (list) list.push(fact);
    else byNode.set(id, [fact]);
  };

  const addNode = (node: GNode) => {
    nodes.set(node.id, node);
    if (node.group) {
      const g = groups.get(node.group);
      if (g) g.size += 1;
    }
    return node;
  };

  addNode({
    id: 'user',
    label: 'user',
    kind: 'user',
    entityType: null,
    degree: 0,
    group: null,
    fx: 0,
    fy: 0,
  });

  const entityNode = (raw: string, hub: ConversationHub): GNode => {
    const id = raw.trim().toLowerCase();
    const existing = nodes.get(id);
    if (existing) return existing;
    if (!groups.has(hub.id)) groups.set(hub.id, { hub, size: 0 });
    const entity = entityByName.get(id);
    return addNode({
      id,
      label: entity?.name ?? raw.trim(),
      kind: 'entity',
      entityType: entity?.type ?? null,
      degree: 0,
      group: hub.id,
    });
  };

  const link = (
    source: string,
    target: string,
    predicate: string,
    fact: SemanticFact,
    curvature = 0,
  ) => {
    const key = `${source}=>${target}`;
    let l = links.get(key);
    if (!l) {
      l = { source, target, predicates: [], facts: [], curvature };
      links.set(key, l);
    }
    l.facts.push(fact);
    if (!l.predicates.includes(predicate)) l.predicates.push(predicate);
  };

  for (const fact of facts) {
    const hub = hubOf(fact);
    const isUser = fact.subject === 'user';
    // The user is the centre on either end: "priya → wants to run with →
    // user" is a fact about priya.
    const isEntityObject = fact.objectIsEntity && fact.object !== 'user';
    if (isUser && !isEntityObject) {
      userFacts.push(fact);
      record('user', fact);
      continue;
    }
    const subject = isUser ? null : entityNode(fact.subject, hub);
    const object = isEntityObject ? entityNode(fact.object, hub) : null;
    if (subject && object && subject.id === object.id) continue;
    if (subject) record(subject.id, fact);
    if (object) record(object.id, fact);

    if (!subject && object) {
      link('user', object.id, fact.predicate, fact);
    } else if (subject && object) {
      link(subject.id, object.id, fact.predicate, fact, 0.2);
    } else if (subject) {
      // Scoped to the entity: two cars that are both "white" get two leaves.
      // Same shape as every other fact: the circle is the object, the arrow
      // is the predicate.
      const id = `${subject.id}::${fact.object.trim().toLowerCase()}`;
      if (!nodes.has(id)) {
        addNode({
          id,
          label: fact.object.trim(),
          kind: 'value',
          entityType: null,
          degree: 0,
          group: subject.group,
        });
      }
      record(id, fact);
      link(subject.id, id, fact.predicate, fact);
    }
  }
  for (const node of nodes.values())
    node.degree = byNode.get(node.id)?.length ?? 0;

  // Anchors evenly around the user, in first-seen order. Bigger clusters get
  // more angle so they are not squeezed between small ones.
  const total = [...groups.values()].reduce((n, g) => n + g.size, 0) || 1;
  const clusters: GCluster[] = [];
  let angle = -Math.PI / 2;
  for (const { hub, size } of groups.values()) {
    const span = (size / total) * 2 * Math.PI;
    const mid = angle + span / 2;
    clusters.push({
      ...hub,
      x: Math.cos(mid) * CLUSTER_RADIUS,
      y: Math.sin(mid) * CLUSTER_RADIUS,
    });
    angle += span;
  }

  return {
    graphData: { nodes: [...nodes.values()], links: [...links.values()] },
    factsByNode: byNode,
    userFacts,
    clusters,
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d';
import {
  ENTITY_TYPES,
  type Episode,
  type EntityType,
  type SemanticEntity,
  type SemanticFact,
} from '@memory-soda/types';
import { quiet, describeError } from './api';
import { noopAddOp, type AddOp } from './types';
import { FactRow } from './fact-row';
import { Button } from '@/components/ui/button';
import { day } from '@/lib/fact-status';
import {
  OTHER_HUB,
  buildGraph,
  collisionRadius,
  linkEnd,
  linkEndId,
  radiusOf,
  type ConversationHub,
  type GCluster,
  type GNode,
  type GLink,
} from './graph-build';

// The API's own ceilings (see factsQuery / episodesQuery in apps/api), not
// graph-specific limits: this view shows whatever one call can return.
const GRAPH_FACT_LIMIT = 200;
const GRAPH_EPISODE_LIMIT = 100;

// Fixed hue per entity type, the dataviz skill's validated 8-slot categorical
// order. A node-link graph shows every color at once (no adjacency structure
// to lean on), so only the first 8 types get a hue; the rest fold into the
// neutral treatment rather than reusing one - the node's own label is always
// visible too, so color is a clustering aid, never the only way to tell
// nodes apart. Light palette only: the dashboard has no dark-mode toggle.
const ENTITY_COLOR: Partial<Record<EntityType, string>> = {
  PERSON: '#2a78d6',
  ORG: '#eb6834',
  PLACE: '#1baf7a',
  PRODUCT: '#eda100',
  SKILL: '#e87ba4',
  TOPIC: '#008300',
  EVENT: '#4a3aa7',
  FOOD: '#e34948',
};
const INK = '#0b0b0b';
const MUTED = '#898781';
const LINK_IDLE = '#c3c2b7';
const LINK_HOT = '#52514e';
const CHIP = 'rgba(252,252,251,0.85)';

const typeColor = (type: EntityType | null): string =>
  (type && ENTITY_COLOR[type]) || MUTED;

function nodeColor(node: GNode): string {
  if (node.kind === 'user') return INK;
  return node.kind === 'entity' ? typeColor(node.entityType) : MUTED;
}

/** Legend key: the entity type, or the kind for user/value/untyped nodes. */
function typeKey(node: GNode): string {
  return node.kind === 'entity' && node.entityType
    ? node.entityType
    : node.kind;
}

const nodeTooltip = (n: GNode) =>
  `${n.label} (${n.entityType ?? n.kind}) · ${n.degree} fact${n.degree === 1 ? '' : 's'}`;
const linkTooltip = (l: GLink) =>
  l.facts.map((f) => `${f.subject} ${f.predicate} ${f.object}`).join('\n');
const linkCurvature = (l: GLink) => l.curvature;
const afterLinks = () => 'after' as const;

/** Tracks the pixel size of a container so the canvas can fill it exactly. */
function useElementSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, ...size };
}

// Text width is linear in font size, so measure each label once at a
// reference size instead of calling measureText per node per frame.
const REF_FONT = 100;
const textWidths = new Map<string, number>();
function textWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  weight: number,
  fontSize: number,
): number {
  const key = `${weight}|${text}`;
  let w = textWidths.get(key);
  if (w === undefined) {
    const saved = ctx.font;
    ctx.font = `${weight} ${REF_FONT}px system-ui, sans-serif`;
    w = ctx.measureText(text).width;
    ctx.font = saved;
    textWidths.set(key, w);
  }
  return (w * fontSize) / REF_FONT;
}

/** A label on a translucent chip so it stays legible over crossing edges. */
function drawChip(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  opts: {
    fontSize: number;
    weight: number;
    scale: number;
    color: string;
    chip: string;
    align: 'top' | 'middle';
  },
) {
  const { fontSize, weight, scale, color, chip, align } = opts;
  const pad = 2 / scale;
  const w = textWidth(ctx, text, weight, fontSize) + pad * 2;
  const h = fontSize + pad;
  const top = align === 'top' ? y - pad / 2 : y - h / 2;
  ctx.fillStyle = chip;
  ctx.fillRect(x - w / 2, top, w, h);
  ctx.font = `${weight} ${fontSize}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = align;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/** A d3 force: the shape force-graph accepts via `d3Force(name, fn)`. */
interface SimForce {
  (alpha: number): void;
  initialize?: (nodes: GNode[]) => void;
}

/** Pull each node toward its conversation's anchor, so topics settle apart. */
function clusterForce(clusters: GCluster[], strength: number): SimForce {
  const anchor = new Map(clusters.map((c) => [c.id, c]));
  let nodes: GNode[] = [];
  const force: SimForce = (alpha) => {
    for (const n of nodes) {
      const a = n.group ? anchor.get(n.group) : undefined;
      if (!a || n.fx !== undefined) continue;
      n.vx = (n.vx ?? 0) + (a.x - (n.x ?? 0)) * strength * alpha;
      n.vy = (n.vy ?? 0) + (a.y - (n.y ?? 0)) * strength * alpha;
    }
  };
  force.initialize = (ns) => {
    nodes = ns;
  };
  return force;
}

/**
 * Keep circles and their labels apart. force-graph's bundled d3-force-3d has
 * a forceCollide but ships no typings, and a pairwise pass over the
 * hundred-odd nodes a dataset produces is cheap enough per tick.
 * ponytail: O(n²) per tick; switch to a quadtree if datasets reach thousands.
 */
function collideForce(strength: number): SimForce {
  let nodes: GNode[] = [];
  let radii: number[] = [];
  const force: SimForce = (alpha) => {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      const ra = radii[i];
      if (!a || ra === undefined) continue;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const rb = radii[j];
        if (!b || rb === undefined) continue;
        const dx = (b.x ?? 0) - (a.x ?? 0);
        const dy = (b.y ?? 0) - (a.y ?? 0);
        // Labels sit below circles and spread sideways, so the exclusion zone
        // is an ellipse: full radius across, a third of it vertically.
        const need = ra + rb;
        const scaled = Math.sqrt(dx * dx + 9 * dy * dy) || 1e-3;
        if (scaled >= need) continue;
        const push = ((need - scaled) / scaled) * strength * alpha;
        const px = dx * push;
        const py = dy * push;
        if (a.fx === undefined) {
          a.vx = (a.vx ?? 0) - px;
          a.vy = (a.vy ?? 0) - py;
        }
        if (b.fx === undefined) {
          b.vx = (b.vx ?? 0) + px;
          b.vy = (b.vy ?? 0) + py;
        }
      }
    }
  };
  force.initialize = (ns) => {
    nodes = ns;
    radii = ns.map(collisionRadius);
  };
  return force;
}

interface Highlight {
  nodeIds: Set<string>;
  linkSet: Set<GLink>;
}

function FactPanel({
  title,
  subtitle,
  facts,
  projectId,
  onClose,
}: {
  title: string;
  subtitle: string;
  facts: SemanticFact[];
  projectId: string;
  onClose: () => void;
}) {
  return (
    <div className="border-t border-border max-h-56 overflow-y-auto p-2 space-y-1.5 bg-card shrink-0">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="xs"
          className="text-muted-foreground"
          onClick={onClose}
        >
          ✕
        </Button>
        <span className="text-xs font-semibold">{title}</span>
        <span className="text-[10px] text-muted-foreground">{subtitle}</span>
      </div>
      <ul className="space-y-1.5">
        {facts.map((f) => (
          <FactRow
            key={f.factId}
            fact={f}
            threshold={null}
            projectId={projectId}
          />
        ))}
      </ul>
    </div>
  );
}

/**
 * All of a dataset's live facts, rendered as a node-link graph clustered by
 * conversation (see `buildGraph`). Canvas-rendered (react-force-graph-2d) so
 * it stays fast well past the ~150 nodes a dataset's facts normally produce;
 * the fact list itself is capped at the API's own limit, so load time never
 * depends on graph size.
 *
 * Mount with `key={`${projectId}:${dataset}`}`: a new dataset is a new graph,
 * so all state resets by remount rather than by effect.
 */
export function GraphTab({
  projectId,
  dataset,
  active,
  addOp = noopAddOp,
  threadId = null,
}: {
  projectId: string;
  dataset: string;
  active: boolean;
  /** Omit on pages with no ops log (e.g. the dataset browser). */
  addOp?: AddOp;
  /** The conversation to offer as a "this conversation" scope, if any. */
  threadId?: string | null;
}) {
  const [facts, setFacts] = useState<SemanticFact[]>([]);
  const [entities, setEntities] = useState<SemanticEntity[]>([]);
  // Facts carry episodeId, not threadId; episodes resolve them to the
  // conversation they came from, which is both the cluster they belong to
  // and the "this conversation" scope.
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [showAbout, setShowAbout] = useState(false);
  const [view, setView] = useState<'dataset' | 'thread'>(
    threadId ? 'thread' : 'dataset',
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GNode | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  // Legend doubles as a type filter: entries in this set are hidden.
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const loadedOnce = useRef(false);
  const fgRef = useRef<ForceGraphMethods<GNode, GLink>>(undefined);
  // Reset whenever the graph data changes identity so the new layout gets fitted.
  const fitDone = useRef(false);
  const { ref: containerRef, width, height } = useElementSize();

  const ready = !!projectId && !!dataset.trim();
  const scope = dataset.trim();

  const load = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    setError(null);
    try {
      const [factsRes, entityRows, episodeRes] = await Promise.all([
        quiet(projectId, (memory) =>
          memory.listFacts(scope, { limit: GRAPH_FACT_LIMIT }),
        ),
        quiet(projectId, (memory) => memory.listEntities(scope)),
        quiet(projectId, (memory) =>
          memory.listEpisodes(scope, {
            status: 'all',
            limit: GRAPH_EPISODE_LIMIT,
          }),
        ),
      ]);
      setFacts(factsRes.facts);
      setEntities(entityRows);
      setEpisodes(episodeRes.episodes);
      loadedOnce.current = true;
    } catch (err) {
      const { message, trace } = describeError(err, 'Failed to load graph');
      setError(message);
      addOp('error', { message }, trace);
    } finally {
      setLoading(false);
    }
  }, [projectId, scope, ready, addOp]);

  // A newly-picked conversation (not the initial mount value) defaults the
  // view back to "this conversation".
  const prevThreadId = useRef(threadId);
  useEffect(() => {
    if (prevThreadId.current === threadId) return;
    prevThreadId.current = threadId;
    setView(threadId ? 'thread' : 'dataset');
  }, [threadId]);

  useEffect(() => {
    if (active && !loadedOnce.current) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // One cluster per thread (a playground thread with a short auto-episode
  // interval would otherwise sprout a cluster per message), labelled by its
  // newest summarised episode. Facts with no episode (manually added) share
  // one "Other" cluster rather than dropping out of the picture.
  const hubOf = useMemo(() => {
    const byThread = new Map<string, Episode[]>();
    for (const e of episodes) {
      const key = e.threadId ?? e.episodeId;
      const list = byThread.get(key);
      if (list) list.push(e);
      else byThread.set(key, [e]);
    }
    const hubs = new Map<string, ConversationHub>();
    for (const [key, list] of byThread) {
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const summary = list.find((e) => e.summary)?.summary;
      const label = summary
        ? summary.length > 48
          ? `${summary.slice(0, 47).trimEnd()}…`
          : summary
        : `Conversation ${day(list[0]?.startedAt ?? list[0]?.createdAt ?? '')}`;
      const hub = { id: `c:${key}`, label };
      for (const e of list) hubs.set(e.episodeId, hub);
    }
    return (fact: SemanticFact) =>
      (fact.episodeId && hubs.get(fact.episodeId)) || OTHER_HUB;
  }, [episodes]);

  // A fact with no episode (manually added) has no thread to belong to, so it
  // drops out of the "conversation" view.
  const scopedFacts = useMemo(
    () =>
      view === 'thread' && threadId
        ? facts.filter((f) => hubOf(f).id === `c:${threadId}`)
        : facts,
    [facts, view, threadId, hubOf],
  );

  // Referentially stable across hover/selection changes, only the scoped
  // facts/entities rebuild it - react-force-graph restarts the layout
  // simulation whenever `graphData` changes identity, so this must not
  // depend on UI-only state like hover, selection or the legend filter.
  const { graphData, factsByNode, userFacts, clusters } = useMemo(
    () => buildGraph(scopedFacts, entities, hubOf),
    [scopedFacts, entities, hubOf],
  );

  // Layout forces: spokes are long so clusters have room, leaves hug their
  // entity, clusters pull toward their anchor, nothing overlaps.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force('center', null);
    fg.d3Force('charge')?.strength(-220);
    fg.d3Force('link')?.distance((l: GLink) => {
      if (linkEnd(l.source)?.kind === 'user') return 280;
      // Room for the predicate chip on the arrow.
      if (linkEnd(l.target)?.kind === 'value') return 70;
      return 110;
    });
    fg.d3Force('cluster', clusterForce(clusters, 0.1));
    fg.d3Force('collide', collideForce(0.8));
    fg.d3ReheatSimulation();
  }, [clusters]);

  // Legend filtering rebuilds the graph data on purpose: a new identity
  // restarts the layout, so the remaining nodes visibly re-settle into the
  // space the hidden ones left. Visibility predicates would be cheaper but
  // freeze the picture, which reads as nothing having happened.
  const nodeVisible = useCallback(
    (n: GNode) => !hiddenTypes.has(typeKey(n)),
    [hiddenTypes],
  );
  const shownGraph = useMemo(() => {
    if (hiddenTypes.size === 0) return graphData;
    const nodes = graphData.nodes.filter(nodeVisible);
    const keep = new Set(nodes.map((n) => n.id));
    const links = graphData.links.filter(
      (l) => keep.has(linkEndId(l.source)) && keep.has(linkEndId(l.target)),
    );
    return { nodes, links };
  }, [graphData, hiddenTypes, nodeVisible]);
  const shownNodes = shownGraph.nodes.length;
  useEffect(() => {
    fitDone.current = false;
  }, [shownGraph]);

  // Hover wins over selection. Kept in a ref so the draw callbacks stay
  // stable: force-graph repaints every frame anyway, so a hover change needs
  // no prop change to show up, and pushing fresh callbacks per mouse move
  // through its prop setters was the only cost.
  const focusId = hoverId ?? selected?.id ?? null;
  const highlight = useMemo((): Highlight | null => {
    if (!focusId) return null;
    const nodeIds = new Set<string>([focusId]);
    const linkSet = new Set<GLink>();
    for (const l of shownGraph.links) {
      if (linkEndId(l.source) === focusId || linkEndId(l.target) === focusId) {
        linkSet.add(l);
        nodeIds.add(linkEndId(l.source));
        nodeIds.add(linkEndId(l.target));
      }
    }
    return { nodeIds, linkSet };
  }, [focusId, shownGraph.links]);
  const highlightRef = useRef<Highlight | null>(null);
  highlightRef.current = highlight;

  const drawNode = useCallback(
    (node: GNode, ctx: CanvasRenderingContext2D, scale: number) => {
      const h = highlightRef.current;
      const r = radiusOf(node);
      ctx.globalAlpha = h && !h.nodeIds.has(node.id) ? 0.25 : 1;
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fillStyle = nodeColor(node);
      ctx.fill();
      if (node.kind === 'user') {
        ctx.lineWidth = 1.5 / scale;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
      const value = node.kind === 'value';
      drawChip(ctx, node.label, x, y + r + 2 / scale, {
        fontSize: Math.max((value ? 9 : 11) / scale, 3),
        weight: value ? 400 : 600,
        scale,
        color: value ? MUTED : INK,
        chip: CHIP,
        align: 'top',
      });
      ctx.globalAlpha = 1;
    },
    [],
  );

  // Hit area for hover/drag. Radii are in graph units, so a degree-1 node
  // zoomed out to fit a large graph is a ~3px target; floor it at a usable
  // screen size, and make the label grabbable too, since that's what the eye
  // lands on.
  const paintNodePointerArea = useCallback(
    (
      node: GNode,
      color: string,
      ctx: CanvasRenderingContext2D,
      scale: number,
    ) => {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const r = radiusOf(node);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(r, 10 / scale), 0, 2 * Math.PI);
      ctx.fill();
      // A solid block over the label, no text: the hit canvas must stay
      // free of anti-aliased edges that would blend into other nodes' colors.
      const fontSize = Math.max((node.kind === 'value' ? 9 : 11) / scale, 3);
      const w =
        textWidth(
          ctx,
          node.label,
          node.kind === 'value' ? 400 : 600,
          fontSize,
        ) +
        4 / scale;
      ctx.fillRect(x - w / 2, y + r + 1 / scale, w, fontSize + 2 / scale);
    },
    [],
  );

  // The user's action on an entity is the label on its spoke, always drawn
  // (the user is implied, the action is the fact), at the curve's midpoint
  // (the quadratic-bezier point at t=0.5 force-graph draws through:
  // 0.5*straightMidpoint + 0.5*controlPoint). Hidden outside a focused
  // neighbourhood so hovering reads as a spotlight.
  const drawLinkLabel = useCallback(
    (link: GLink, ctx: CanvasRenderingContext2D, scale: number) => {
      const h = highlightRef.current;
      if (link.predicates.length === 0 || (h && !h.linkSet.has(link))) return;
      const src = linkEnd(link.source);
      const tgt = linkEnd(link.target);
      if (!src || !tgt) return;
      const x1 = src.x ?? 0;
      const y1 = src.y ?? 0;
      const x2 = tgt.x ?? 0;
      const y2 = tgt.y ?? 0;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const lx = (x1 + x2) / 2 + ((-dy / len) * link.curvature * len) / 2;
      const ly = (y1 + y2) / 2 + ((dx / len) * link.curvature * len) / 2;
      drawChip(ctx, link.predicates.join(' · '), lx, ly, {
        fontSize: Math.max(9 / scale, 2.5),
        weight: 400,
        scale,
        color: LINK_HOT,
        chip: CHIP,
        align: 'middle',
      });
    },
    [],
  );

  const linkColor = useCallback(
    (l: GLink) => (highlightRef.current?.linkSet.has(l) ? LINK_HOT : LINK_IDLE),
    [],
  );
  const linkWidth = useCallback(
    (l: GLink) => (highlightRef.current?.linkSet.has(l) ? 1.6 : 1),
    [],
  );

  // Conversation names, faint, above the live centroid of each cluster's
  // entities (not at the anchor: the forces settle clusters wherever they
  // balance, and a label left at the anchor floats in empty space).
  const drawClusterLabels = useCallback(
    (ctx: CanvasRenderingContext2D, scale: number) => {
      const sums = new Map<
        string,
        { x: number; y: number; n: number; top: number }
      >();
      for (const node of shownGraph.nodes) {
        if (node.kind !== 'entity' || !node.group) continue;
        const x = node.x ?? 0;
        const y = node.y ?? 0;
        const s = sums.get(node.group) ?? { x: 0, y: 0, n: 0, top: Infinity };
        s.x += x;
        s.y += y;
        s.n += 1;
        s.top = Math.min(s.top, y);
        sums.set(node.group, s);
      }
      const fontSize = Math.max(10 / scale, 3);
      ctx.save();
      ctx.font = `500 ${fontSize}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      for (const c of clusters) {
        const s = sums.get(c.id);
        if (!s) continue;
        ctx.fillText(c.label, s.x / s.n, s.top - 22 / scale);
      }
      ctx.restore();
    },
    [clusters, shownGraph.nodes],
  );

  const legend = useMemo(() => {
    const types = new Set<EntityType>();
    let hasUntyped = false;
    let hasValue = false;
    for (const n of graphData.nodes) {
      if (n.kind === 'user') continue;
      if (n.kind === 'value') hasValue = true;
      else if (n.entityType) types.add(n.entityType);
      else hasUntyped = true;
    }
    const entries: { key: string; label: string; color: string }[] = [
      { key: 'user', label: 'user', color: INK },
    ];
    // Fixed hue order (never cycled), not fact-iteration order.
    for (const type of ENTITY_TYPES) {
      if (types.has(type))
        entries.push({ key: type, label: type, color: typeColor(type) });
    }
    if (hasUntyped)
      entries.push({ key: 'entity', label: 'other', color: MUTED });
    if (hasValue) entries.push({ key: 'value', label: 'detail', color: MUTED });
    return entries;
  }, [graphData.nodes]);

  return (
    <div className={active ? 'flex-1 flex flex-col min-h-0' : 'hidden'}>
      <div className="p-2 border-b border-border flex items-center gap-3 bg-card">
        <h4 className="text-[10px] uppercase tracking-wide text-muted-foreground whitespace-nowrap">
          {loading
            ? 'Loading…'
            : `${shownNodes} nodes · ${scopedFacts.length} facts`}
          {!loading && facts.length === GRAPH_FACT_LIMIT && (
            <span title={`Showing the first ${GRAPH_FACT_LIMIT} facts`}>
              {' '}
              (capped)
            </span>
          )}
        </h4>
        {threadId && (
          <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5 shrink-0">
            <Button
              variant={view === 'thread' ? 'secondary' : 'ghost'}
              size="xs"
              className="h-5 px-2 text-[10px]"
              onClick={() => setView('thread')}
              title="Only this conversation's facts"
            >
              Conversation
            </Button>
            <Button
              variant={view === 'dataset' ? 'secondary' : 'ghost'}
              size="xs"
              className="h-5 px-2 text-[10px]"
              onClick={() => setView('dataset')}
              title="Every conversation in this dataset"
            >
              Dataset
            </Button>
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          {legend.map((l) => {
            const hidden = hiddenTypes.has(l.key);
            return (
              <button
                key={l.key}
                type="button"
                onClick={() => {
                  setHiddenTypes((prev) => {
                    const next = new Set(prev);
                    if (next.has(l.key)) next.delete(l.key);
                    else next.add(l.key);
                    return next;
                  });
                  // Newly hiding this type: drop the fact panel if it was showing
                  // a node of that type, so it doesn't reference an off-screen node.
                  if (!hidden)
                    setSelected((sel) =>
                      sel && typeKey(sel) === l.key ? null : sel,
                    );
                }}
                className={`flex items-center gap-1 text-[10px] ${
                  hidden ? 'text-muted-foreground/40' : 'text-muted-foreground'
                }`}
                title={hidden ? `Show ${l.label}` : `Hide ${l.label}`}
              >
                <span
                  className="inline-block size-2 rounded-full"
                  style={{
                    backgroundColor: hidden ? 'transparent' : l.color,
                    border: `1px solid ${l.color}`,
                  }}
                />
                {l.label.toLowerCase()}
              </button>
            );
          })}
        </div>
        {userFacts.length > 0 && (
          <Button
            variant={showAbout ? 'secondary' : 'ghost'}
            size="xs"
            className="h-5 px-2 text-[10px] text-muted-foreground"
            onClick={() => setShowAbout((v) => !v)}
            title="Facts about the user that have no entity to hang off"
          >
            About user ({userFacts.length})
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          onClick={() => fgRef.current?.zoomToFit(400, 30)}
          disabled={loading || !ready || shownNodes === 0}
          title="Recenter graph"
        >
          ⌖
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground ml-auto"
          onClick={() => void load()}
          disabled={loading || !ready}
          title="Refresh graph"
        >
          ↻
        </Button>
      </div>

      {error && (
        <div className="mx-2 mt-2 px-3 py-2 rounded-md bg-destructive/10 text-destructive text-xs">
          {error}
        </div>
      )}

      <div ref={containerRef} className="flex-1 min-h-0 relative">
        {!ready ? (
          <p className="text-xs text-muted-foreground p-2">
            Select a project and dataset above.
          </p>
        ) : graphData.links.length === 0 && !loading ? (
          <p className="text-xs text-muted-foreground p-2">
            {view === 'thread' && threadId
              ? 'No facts from this conversation yet.'
              : 'No facts yet, they extract automatically after conversations.'}
          </p>
        ) : shownNodes === 0 ? (
          <p className="text-xs text-muted-foreground p-2">
            Everything is hidden — click a legend entry to show it again.
          </p>
        ) : (
          width > 0 &&
          height > 0 && (
            <ForceGraph2D<GNode, GLink>
              ref={fgRef}
              graphData={shownGraph}
              width={width}
              height={height}
              backgroundColor="rgba(0,0,0,0)"
              cooldownTicks={300}
              // Fit the view once per data load. A drag re-heats the engine,
              // and re-fitting on every stop yanked the camera a moment after
              // each drop, which read as the drag not sticking.
              onEngineStop={() => {
                if (fitDone.current) return;
                fitDone.current = true;
                fgRef.current?.zoomToFit(400, 30);
              }}
              // Pin where the user dropped it; force-graph otherwise releases
              // the node and the simulation pulls it straight back.
              onNodeDragEnd={(n) => {
                n.fx = n.x;
                n.fy = n.y;
              }}
              onRenderFramePre={drawClusterLabels}
              nodeCanvasObject={drawNode}
              nodePointerAreaPaint={paintNodePointerArea}
              nodeLabel={nodeTooltip}
              linkColor={linkColor}
              linkWidth={linkWidth}
              linkCurvature={linkCurvature}
              linkDirectionalArrowLength={4}
              linkDirectionalArrowRelPos={1}
              linkCanvasObjectMode={afterLinks}
              linkCanvasObject={drawLinkLabel}
              linkLabel={linkTooltip}
              onNodeHover={(n) => setHoverId(n ? n.id : null)}
              onNodeClick={(n) => setSelected(n)}
              onBackgroundClick={() => setSelected(null)}
            />
          )
        )}
      </div>

      {selected ? (
        <FactPanel
          title={selected.label}
          subtitle={selected.entityType ?? selected.kind}
          facts={factsByNode.get(selected.id) ?? []}
          projectId={projectId}
          onClose={() => setSelected(null)}
        />
      ) : (
        showAbout && (
          <FactPanel
            title="About the user"
            subtitle={`${userFacts.length} facts with no entity`}
            facts={userFacts}
            projectId={projectId}
            onClose={() => setShowAbout(false)}
          />
        )
      )}
    </div>
  );
}

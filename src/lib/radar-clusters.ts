/**
 * radar-clusters — the shared per-topic clustering resource.
 *
 * Semantic (embedding-based) hierarchical clustering over a set of
 * articles, computed ONCE per article-id set and cached server-side
 * (outputs table + in-memory), then reused by every consumer: the
 * evidence map, the Following list grouping, the group-jump nav, and
 * anywhere else the same labels apply. Never recomputed per-view or
 * per-user: the cache key is a hash of the sorted article ids, so two
 * users looking at the same article set share one computation.
 *
 * SHAPE: a tidy surface with unlimited depth. The top level is capped
 * at MAX_TOP_CLUSTERS by keeping the largest natural clusters and
 * folding everything else into one honest generic bucket; nothing is
 * ever discarded. Each node splits recursively into sub-clusters while
 * it has enough members, bottoming out at article leaves.
 *
 * LABELS are lazy and separate: nodes carry label=null until a cheap
 * LLM pass names the level the user can actually see. Labels must be
 * DESCRIPTIVE (what the coverage is about), never evaluative; nodes
 * with no clear common theme keep an honest generic label instead
 * (see radar-cluster-label.ts for enforcement).
 *
 * This module is pure math + types, no server dependencies, so client
 * code can import the types safely.
 */

export interface ClusterNode {
  /** Stable hash of sorted member article ids; also the label cache key. */
  id: string;
  /** null until the lazy labeling pass names this node. */
  label: string | null;
  /** True for honest generic buckets ("Related coverage"); never LLM-labeled. */
  generic: boolean;
  /** Every article id under this node, at any depth. */
  articleIds: string[];
  /** Article ids that sit directly at this node (only when children is empty). */
  leafIds: string[];
  children: ClusterNode[];
}

export interface ClusterTree {
  /** Hash of the full sorted article-id set. */
  key: string;
  clusters: ClusterNode[];
  /** Article ids that had no embedding; folded into the generic bucket. */
  unembeddedIds: string[];
}

export const GENERIC_LABEL = "Related coverage";

/** Named top-level clusters shown on the map surface (plus one generic bucket). */
export const MAX_TOP_CLUSTERS = 5;
/** A node splits into sub-clusters while it has at least this many members. */
export const MIN_SPLIT_SIZE = 6;
const MAX_SUB_CLUSTERS = 4;
const MAX_DEPTH = 3;

/** FNV-1a over the sorted id set; stable across runs and machines. */
export function hashIdSet(ids: string[]): string {
  const joined = [...ids].sort().join("|");
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < joined.length; i++) {
    const c = joined.charCodeAt(i);
    h1 = ((h1 ^ c) * 0x01000193) >>> 0;
    h2 = ((h2 ^ ((c << 1) | 1)) * 0x01000193) >>> 0;
  }
  return `${h1.toString(36)}${h2.toString(36)}`;
}

interface DendroNode {
  memberIds: string[];
  centroid: number[];
  /** Cosine similarity at which this node's two children merged; 1 for leaves. */
  mergeSim: number;
  left: DendroNode | null;
  right: DendroNode | null;
}

function normalize(v: number[]): number[] {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return v.map((x) => x / norm);
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function mergeCentroid(a: DendroNode, b: DendroNode): number[] {
  const wa = a.memberIds.length;
  const wb = b.memberIds.length;
  const out = new Array<number>(a.centroid.length);
  for (let i = 0; i < a.centroid.length; i++) {
    out[i] = (a.centroid[i] * wa + b.centroid[i] * wb) / (wa + wb);
  }
  return normalize(out);
}

/**
 * Agglomerative clustering to a full dendrogram (centroid linkage,
 * cosine similarity). O(n^3) naive; fine for the a-few-hundred-article
 * sets a topic produces.
 */
function buildDendrogram(items: { id: string; vector: number[] }[]): DendroNode | null {
  let active: DendroNode[] = items.map((it) => ({
    memberIds: [it.id],
    centroid: normalize(it.vector),
    mergeSim: 1,
    left: null,
    right: null,
  }));
  if (active.length === 0) return null;

  while (active.length > 1) {
    let bestI = 0;
    let bestJ = 1;
    let bestSim = -Infinity;
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const sim = dot(active[i].centroid, active[j].centroid);
        if (sim > bestSim) {
          bestSim = sim;
          bestI = i;
          bestJ = j;
        }
      }
    }
    const a = active[bestI];
    const b = active[bestJ];
    const merged: DendroNode = {
      memberIds: [...a.memberIds, ...b.memberIds],
      centroid: mergeCentroid(a, b),
      mergeSim: bestSim,
      left: a,
      right: b,
    };
    active = active.filter((_, idx) => idx !== bestI && idx !== bestJ);
    active.push(merged);
  }
  return active[0];
}

/**
 * Cut a dendrogram into at most k natural clusters: repeatedly split
 * the node whose merge was weakest (lowest similarity) until k parts
 * exist or no internal node remains.
 */
function cutIntoK(root: DendroNode, k: number): DendroNode[] {
  const parts: DendroNode[] = [root];
  while (parts.length < k) {
    let weakest = -1;
    let weakestSim = Infinity;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.left && p.right && p.mergeSim < weakestSim) {
        weakestSim = p.mergeSim;
        weakest = i;
      }
    }
    if (weakest === -1) break;
    const node = parts[weakest];
    parts.splice(weakest, 1, node.left!, node.right!);
  }
  return parts;
}

function toClusterNode(dendro: DendroNode, depth: number): ClusterNode {
  const size = dendro.memberIds.length;
  const canSplit = depth < MAX_DEPTH && size >= MIN_SPLIT_SIZE && dendro.left && dendro.right;
  let children: ClusterNode[] = [];
  if (canSplit) {
    const k = Math.min(MAX_SUB_CLUSTERS, Math.max(2, Math.round(size / 5)));
    const parts = cutIntoK(dendro, k).filter((p) => p.memberIds.length > 0);
    if (parts.length >= 2) {
      children = parts
        .sort((a, b) => b.memberIds.length - a.memberIds.length)
        .map((p) => toClusterNode(p, depth + 1));
    }
  }
  return {
    id: hashIdSet(dendro.memberIds),
    label: null,
    generic: false,
    articleIds: dendro.memberIds,
    leafIds: children.length ? [] : dendro.memberIds,
    children,
  };
}

/**
 * Build the full cluster tree for one topic's articles. Items without
 * embeddings arrive via `unembeddedIds` and fold into the generic
 * bucket so nothing is discarded.
 */
export function buildClusterTree(
  items: { id: string; vector: number[] }[],
  unembeddedIds: string[],
): ClusterTree {
  const allIds = [...items.map((i) => i.id), ...unembeddedIds];
  const key = hashIdSet(allIds);
  const root = buildDendrogram(items);
  if (!root) {
    const clusters: ClusterNode[] = unembeddedIds.length
      ? [
          {
            id: hashIdSet(unembeddedIds),
            label: GENERIC_LABEL,
            generic: true,
            articleIds: unembeddedIds,
            leafIds: unembeddedIds,
            children: [],
          },
        ]
      : [];
    return { key, clusters, unembeddedIds };
  }

  // Natural top-level cut, one past the named cap so the smallest
  // parts can fold into the generic bucket instead of being dropped.
  const parts = cutIntoK(root, MAX_TOP_CLUSTERS + 1).sort(
    (a, b) => b.memberIds.length - a.memberIds.length,
  );
  const named = parts.slice(0, MAX_TOP_CLUSTERS).filter((p) => p.memberIds.length >= 2);
  const leftoverIds = [
    ...parts.slice(MAX_TOP_CLUSTERS).flatMap((p) => p.memberIds),
    ...parts.slice(0, MAX_TOP_CLUSTERS).filter((p) => p.memberIds.length < 2).flatMap((p) => p.memberIds),
    ...unembeddedIds,
  ];

  const clusters = named.map((p) => toClusterNode(p, 1));
  if (leftoverIds.length > 0) {
    clusters.push({
      id: hashIdSet(leftoverIds),
      label: GENERIC_LABEL,
      generic: true,
      articleIds: leftoverIds,
      leafIds: leftoverIds,
      children: [],
    });
  }
  return { key, clusters, unembeddedIds };
}

/**
 * Heuristic fallback tree for when embeddings are unavailable: groups
 * by the story-level clusterer's output and labels from tag frequency,
 * MERGING same-label groups so a map can never show two clusters with
 * the same name. Labels here are final (generic-honest), never sent to
 * the LLM. Flat (no sub-levels) — depth needs real semantics.
 */
export function buildFallbackTree(
  articles: {
    id: string;
    activity_types?: string[] | null;
    industry_verticals?: string[] | null;
  }[],
  storyGroups: string[][],
): ClusterTree {
  const key = hashIdSet(articles.map((a) => a.id));
  const byId = new Map(articles.map((a) => [a.id, a]));
  const topTag = (ids: string[]): string | null => {
    const counts = new Map<string, number>();
    for (const id of ids) {
      const a = byId.get(id);
      for (const tag of [...(a?.activity_types ?? []), ...(a?.industry_verticals ?? [])]) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return top ? top[0] : null;
  };

  // Merge story groups by label so names are unique within the map.
  const byLabel = new Map<string, string[]>();
  for (const group of storyGroups) {
    const label = topTag(group) ?? GENERIC_LABEL;
    byLabel.set(label, [...(byLabel.get(label) ?? []), ...group]);
  }

  const entries = [...byLabel.entries()].sort((a, b) => b[1].length - a[1].length);
  const named = entries.filter(([label]) => label !== GENERIC_LABEL).slice(0, MAX_TOP_CLUSTERS);
  const leftoverIds = [
    ...entries
      .filter(([label]) => label !== GENERIC_LABEL)
      .slice(MAX_TOP_CLUSTERS)
      .flatMap(([, ids]) => ids),
    ...(byLabel.get(GENERIC_LABEL) ?? []),
  ];

  const clusters: ClusterNode[] = named.map(([label, ids]) => ({
    id: hashIdSet(ids),
    label,
    generic: false,
    articleIds: ids,
    leafIds: ids,
    children: [],
  }));
  if (leftoverIds.length > 0) {
    clusters.push({
      id: hashIdSet(leftoverIds),
      label: GENERIC_LABEL,
      generic: true,
      articleIds: leftoverIds,
      leafIds: leftoverIds,
      children: [],
    });
  }
  return { key, clusters, unembeddedIds: articles.map((a) => a.id) };
}

/** Every node in the tree, depth-first. */
export function flattenNodes(tree: ClusterTree): ClusterNode[] {
  const out: ClusterNode[] = [];
  const walk = (n: ClusterNode) => {
    out.push(n);
    n.children.forEach(walk);
  };
  tree.clusters.forEach(walk);
  return out;
}

/** Merge freshly fetched labels into a tree (returns a new tree). */
export function applyLabels(tree: ClusterTree, labels: Record<string, string>): ClusterTree {
  const walk = (n: ClusterNode): ClusterNode => ({
    ...n,
    label: n.generic ? n.label : (labels[n.id] ?? n.label),
    children: n.children.map(walk),
  });
  return { ...tree, clusters: tree.clusters.map(walk) };
}

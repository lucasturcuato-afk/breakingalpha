"use client";

/**
 * EvidenceMap — a progressive-disclosure relational graph of matched
 * articles, powered by the SHARED clustering resource (semantic
 * clusters from pipeline embeddings, lazily LLM-labeled; see
 * lib/radar-clusters.ts). The same tree drives the grouped list view
 * and the group-jump nav, so the map never invents its own taxonomy.
 *
 * ORGANIZED SURFACE, UNLIMITED DEPTH: the surface shows the center
 * plus a bounded set of top-level clusters, each a breathing orb with
 * "label · count". Clicking a cluster expands its contents in place:
 * sub-clusters, and at the deepest level every individual article —
 * nothing is capped away, depth is tucked behind expansion. One branch
 * expands at a time (fisheye): the open wedge takes most of the circle
 * and collapsed siblings compress, so the canvas stays tidy at any
 * depth. All positions animate between layouts.
 *
 * EDGE-AWARE: every node clamps inside the canvas with margin; labels
 * flip horizontally near the left/right edges and vertically around
 * the middle; the hover popup flips on both axes so nothing ever
 * clips the container, including mid-animation (positions and their
 * labels move together).
 *
 * REACTIVE LINES: hovering a node (or cursor proximity to one)
 * brightens and thickens its whole branch back to the center with a
 * slow dash flow; other edges recede. Lines convey topical membership
 * ONLY — never stance — and the legend says so, always visible.
 *
 * LABELS are descriptive and lazy: top level arrives labeled; deeper
 * levels are named on expansion via onVisibleNodes (the page wires
 * this to the shared label endpoint). Unnamed nodes show "···" until
 * their honest label lands. Without embeddings the map falls back to
 * heuristic story-grouping with tag labels, deduped so a map can never
 * show two clusters with the same name.
 *
 * LIFE: orbs breathe on seeded loops, gravitate toward the cursor,
 * and the nearest node highlights. Everything disables under
 * prefers-reduced-motion.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { clusterArticles, type Article } from "@/lib/clustering-utils";
import {
  buildFallbackTree,
  type ClusterNode,
  type ClusterTree,
} from "@/lib/radar-clusters";
import { ArticleMemoActions } from "@/components/radar/ArticleMemoActions";

const SERIF = "var(--font-playfair-display), serif";
const MIN_ARTICLES = 4;

/** Vertical squash so the ellipse fills a wide canvas gracefully. */
const Y_SQUASH = 0.78;
/** Ring radius per hub depth (% of canvas). */
const R_HUB_BASE = 26;
const R_HUB_STEP = 15;
/** Fisheye: the expanded wedge's share of its parent's angle. */
const EXPANDED_SHARE = 0.62;
/** Leaf band packing. */
const LEAF_BAND_STEP = 7.5;

export type MapArticle = Article & { primary_company?: string | null };

interface PlacedHub {
  kind: "hub";
  id: string;
  node: ClusterNode;
  depth: number;
  expanded: boolean;
  x: number;
  y: number;
  parent: { x: number; y: number };
  /** Node ids from the top-level hub down to this one (inclusive). */
  chain: string[];
}
interface PlacedLeaf {
  kind: "leaf";
  id: string;
  article: MapArticle;
  x: number;
  y: number;
  parent: { x: number; y: number };
  chain: string[];
}
type PlacedNode = PlacedHub | PlacedLeaf;

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

/** Deterministic id hash (djb2) for stable breathe delays; no Math.random. */
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

function polar(r: number, angle: number) {
  return { x: 50 + r * Math.cos(angle), y: 50 + r * Y_SQUASH * Math.sin(angle) };
}

function clampPos(p: { x: number; y: number }) {
  return { x: Math.min(94, Math.max(6, p.x)), y: Math.min(91, Math.max(9, p.y)) };
}

/**
 * Fisheye wedge layout. Every visible node owns an angular wedge of
 * the circle; an expanded node's wedge grows to EXPANDED_SHARE of its
 * parent wedge and its children subdivide it recursively. Leaves pack
 * into concentric bands inside their parent's wedge — every article
 * places, dozens or more, denser bands further out.
 */
function layoutTree(
  clusters: ClusterNode[],
  expandedPath: string[],
  articleById: Map<string, MapArticle>,
): PlacedNode[] {
  const placed: PlacedNode[] = [];

  const placeLevel = (
    siblings: ClusterNode[],
    depth: number,
    angleStart: number,
    angleSpan: number,
    parentPos: { x: number; y: number },
    parentChain: string[],
  ) => {
    if (siblings.length === 0) return;
    const expandedId = expandedPath[depth - 1] ?? null;
    const hasExpanded = siblings.some((s) => s.id === expandedId);
    const collapsedShare = hasExpanded
      ? (1 - EXPANDED_SHARE) / Math.max(1, siblings.length - 1)
      : 1 / siblings.length;

    let cursor = angleStart;
    for (const node of siblings) {
      const isExpanded = node.id === expandedId;
      const share = hasExpanded ? (isExpanded ? EXPANDED_SHARE : collapsedShare) : collapsedShare;
      const wedge = angleSpan * share;
      const theta = cursor + wedge / 2;
      cursor += wedge;

      const pos = clampPos(polar(R_HUB_BASE + R_HUB_STEP * (depth - 1), theta));
      const chain = [...parentChain, node.id];
      placed.push({
        kind: "hub",
        id: node.id,
        node,
        depth,
        expanded: isExpanded,
        x: pos.x,
        y: pos.y,
        parent: parentPos,
        chain,
      });
      if (!isExpanded) continue;

      if (node.children.length > 0) {
        placeLevel(node.children, depth + 1, cursor - wedge, wedge, pos, chain);
      } else {
        // Deepest level: every article, packed in bands. Recency inward.
        const leaves = node.leafIds
          .map((id) => articleById.get(id))
          .filter((a): a is MapArticle => !!a)
          .sort((a, b) => {
            const tA = a.published_at ? new Date(a.published_at).getTime() : 0;
            const tB = b.published_at ? new Date(b.published_at).getTime() : 0;
            return tB - tA;
          });
        const usable = wedge * 0.86;
        let index = 0;
        let band = 0;
        while (index < leaves.length) {
          const rBand = R_HUB_BASE + R_HUB_STEP * depth + band * LEAF_BAND_STEP;
          // Slots per band grow with arc length; min 3 so thin wedges still fill.
          const cap = Math.max(3, Math.floor((usable * rBand) / 9));
          const slice = leaves.slice(index, index + cap);
          slice.forEach((article, j) => {
            const angle =
              slice.length === 1
                ? theta
                : theta - usable / 2 + (usable * (j + 0.5)) / slice.length;
            const p = clampPos(polar(rBand, angle));
            placed.push({
              kind: "leaf",
              id: article.id,
              article,
              x: p.x,
              y: p.y,
              parent: pos,
              chain,
            });
          });
          index += cap;
          band += 1;
        }
      }
    }
  };

  placeLevel(clusters, 1, -Math.PI / 2, Math.PI * 2, { x: 50, y: 50 }, []);
  return placed;
}

function ThinState({ articles }: { articles: MapArticle[] }) {
  return (
    <div>
      <p className="mb-3 font-sans text-[12px] text-text-muted">
        Only {articles.length} matched article{articles.length === 1 ? "" : "s"} so
        far; not enough to cluster into a map yet. Here is what matched:
      </p>
      <div className="motion-stagger grid gap-3 md:grid-cols-2">
        {articles.map((a) => (
          <article
            key={a.id}
            className="group card-hover-lift rounded-lg border border-border-subtle bg-elevated px-4 py-3.5"
          >
            <p
              className="text-text-primary"
              style={{ fontFamily: SERIF, fontSize: "14px", lineHeight: 1.35, fontWeight: 600 }}
            >
              {a.title}
            </p>
            <p className="mt-1 font-sans text-[11px] text-text-faint">{a.source}</p>
            <ArticleMemoActions article={a} alwaysVisible />
          </article>
        ))}
      </div>
    </div>
  );
}

export function EvidenceMap({
  centerLabel,
  articles,
  tree = null,
  clusterStatus = "unavailable",
  onVisibleNodes,
}: {
  centerLabel: string;
  articles: MapArticle[];
  /** Shared clustering resource; omit to use the heuristic fallback. */
  tree?: ClusterTree | null;
  clusterStatus?: "idle" | "loading" | "ready" | "unavailable";
  /** Called with visible, still-unlabeled nodes so the page can label lazily. */
  onVisibleNodes?: (nodes: ClusterNode[]) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [expandedPath, setExpandedPath] = useState<string[]>([]);
  const reducedMotion = useReducedMotion();

  const articleById = useMemo(
    () => new Map(articles.map((a) => [a.id, a])),
    [articles],
  );

  // Semantic tree when available; honest heuristic fallback otherwise.
  const effectiveTree: ClusterTree | null = useMemo(() => {
    if (tree) return tree;
    if (clusterStatus === "loading") return null;
    const groups = clusterArticles(articles).map((c) => [
      c.leadArticle.id,
      ...c.relatedArticles.map((a) => a.id),
    ]);
    return buildFallbackTree(articles, groups);
  }, [tree, clusterStatus, articles]);

  const nodes = useMemo(
    () => (effectiveTree ? layoutTree(effectiveTree.clusters, expandedPath, articleById) : []),
    [effectiveTree, expandedPath, articleById],
  );

  // Lazy labeling: report visible unlabeled hubs whenever disclosure changes.
  const visibleUnlabeled = useMemo(
    () =>
      nodes
        .filter((n): n is PlacedHub => n.kind === "hub")
        .map((n) => n.node)
        .filter((n) => !n.generic && n.label === null),
    [nodes],
  );
  const unlabeledKey = visibleUnlabeled.map((n) => n.id).join("|");
  const onVisibleNodesRef = useRef(onVisibleNodes);
  onVisibleNodesRef.current = onVisibleNodes;
  useEffect(() => {
    if (visibleUnlabeled.length > 0) onVisibleNodesRef.current?.(visibleUnlabeled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlabeledKey]);

  if (articles.length < MIN_ARTICLES) return <ThinState articles={articles} />;

  if (!effectiveTree) {
    return (
      <div className="motion-rise-in flex h-[320px] w-full items-center justify-center rounded-xl border border-border-subtle bg-elevated">
        <p className="font-sans text-[12px] text-text-muted">Clustering coverage…</p>
      </div>
    );
  }

  const toggleExpand = (hub: PlacedHub) => {
    setHoveredId(null);
    setExpandedPath((prev) => {
      const depthIdx = hub.depth - 1;
      if (prev[depthIdx] === hub.id) return prev.slice(0, depthIdx);
      return [...hub.chain];
    });
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (reducedMotion) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => setCursor({ x, y }));
  };

  let nearestId: string | null = null;
  if (cursor && !reducedMotion && !hoveredId) {
    let best = 13;
    for (const node of nodes) {
      const d = Math.hypot(node.x - cursor.x, (node.y - cursor.y) * 0.75);
      if (d < best) {
        best = d;
        nearestId = node.id;
      }
    }
  }

  // The branch to light up: the hovered (or cursor-nearest) node's
  // chain of ancestors back to the center.
  const focusNode = nodes.find((n) => n.id === (hoveredId ?? nearestId));
  const focusChain = new Set(focusNode ? [...focusNode.chain, focusNode.id] : []);

  /* Exaggerated-but-smooth gravitation toward the cursor. */
  const parallax = (node: PlacedNode): string => {
    if (!cursor || reducedMotion) return "translate(-50%, -50%)";
    const dx = cursor.x - node.x;
    const dy = cursor.y - node.y;
    const dist = Math.hypot(dx, dy);
    const strength = Math.max(0, 1 - dist / 45) * (node.kind === "hub" ? 5 : 11);
    const norm = dist || 1;
    return `translate(calc(-50% + ${((dx / norm) * strength).toFixed(1)}px), calc(-50% + ${((dy / norm) * strength).toFixed(1)}px))`;
  };

  /* Popup flips on BOTH axes so it can never leave the container. */
  const popupStyle = (node: PlacedNode): React.CSSProperties => {
    const style: React.CSSProperties = {};
    // Upper half opens downward into free canvas, lower half upward.
    if (node.y <= 50) style.top = "calc(100% + 10px)";
    else style.bottom = "calc(100% + 10px)";
    if (node.x < 20) {
      style.left = 0;
      style.transform = "none";
    } else if (node.x > 80) {
      style.right = 0;
      style.transform = "none";
    } else {
      style.left = "50%";
      style.transform = "translateX(-50%)";
    }
    return style;
  };

  /* Labels flip horizontally near the side edges so text never clips. */
  const labelPlacement = (node: PlacedNode): { className: string; style: React.CSSProperties } => {
    const vertical = node.y >= 50 ? "top-full mt-1.5" : "bottom-full mb-1.5";
    if (node.x < 10) {
      return { className: `${vertical} left-0 text-left`, style: { transform: "none" } };
    }
    if (node.x > 90) {
      return { className: `${vertical} right-0 text-right`, style: { transform: "none" } };
    }
    return { className: `${vertical} left-1/2 text-center`, style: { transform: "translateX(-50%)" } };
  };

  const maxDepthVisible = expandedPath.length;
  const tall = nodes.length > 20 || maxDepthVisible >= 2;
  const hovered = nodes.find((n) => n.id === hoveredId);

  return (
    <div className="motion-rise-in">
      <div
        ref={containerRef}
        onMouseMove={onMouseMove}
        onMouseLeave={() => setCursor(null)}
        data-popup-open={hovered ? "true" : "false"}
        className="relative w-full overflow-hidden rounded-xl border border-border-subtle bg-elevated"
        style={{
          height: tall ? "680px" : "580px",
          transition: "height var(--duration-slow) var(--ease-out)",
        }}
      >
        {/* Cursor glow. */}
        {cursor && !reducedMotion && (
          <div
            aria-hidden
            className="evidence-map-glow pointer-events-none absolute h-52 w-52 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              left: `${cursor.x}%`,
              top: `${cursor.y}%`,
              background:
                "radial-gradient(circle, color-mix(in srgb, var(--gold) 13%, transparent) 0%, transparent 70%)",
              transition: `left var(--duration-base) var(--ease-out), top var(--duration-base) var(--ease-out)`,
            }}
          />
        )}

        {/* Branch lines: membership/relatedness only, never stance. */}
        <svg
          aria-hidden
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {nodes.map((node) => {
            const onFocusBranch = focusChain.has(node.id);
            const anyFocus = focusChain.size > 0;
            return (
              <line
                key={`edge-${node.id}`}
                className={onFocusBranch && !reducedMotion ? "map-edge-flow" : undefined}
                x1={node.parent.x}
                y1={node.parent.y}
                x2={node.x}
                y2={node.y}
                stroke={
                  onFocusBranch
                    ? "color-mix(in srgb, var(--gold) 62%, transparent)"
                    : node.kind === "hub"
                      ? "color-mix(in srgb, var(--gold) 32%, transparent)"
                      : "var(--border-hi)"
                }
                strokeWidth={onFocusBranch ? 1.8 : node.kind === "hub" ? 1.4 : 1}
                vectorEffect="non-scaling-stroke"
                opacity={anyFocus && !onFocusBranch ? 0.28 : onFocusBranch ? 1 : 0.8}
                style={{
                  transition:
                    "opacity var(--duration-base) var(--ease-out), stroke var(--duration-base) var(--ease-out), x1 var(--duration-slow) var(--ease-out), y1 var(--duration-slow) var(--ease-out), x2 var(--duration-slow) var(--ease-out), y2 var(--duration-slow) var(--ease-out)",
                }}
              />
            );
          })}
        </svg>

        {/* Center: the claim/topic. */}
        <div
          className="absolute z-20 flex h-[130px] w-[130px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-espresso p-4 text-center text-cream shadow-md dark:border dark:border-border-default dark:bg-overlay"
          style={{ left: "50%", top: "50%" }}
        >
          <div>
            <p className="font-sans text-[8px] font-semibold uppercase tracking-[0.16em] text-cream/60 dark:text-text-faint">
              Claim / topic
            </p>
            <p
              className="mt-0.5"
              style={{
                fontFamily: SERIF,
                fontSize: "11.5px",
                fontWeight: 600,
                lineHeight: 1.3,
                display: "-webkit-box",
                WebkitLineClamp: 4,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {centerLabel}
            </p>
          </div>
        </div>

        {/* Nodes. */}
        {nodes.map((node) => {
          const isHovered = hoveredId === node.id;
          const isNearest = nearestId === node.id;
          const label = labelPlacement(node);

          if (node.kind === "hub") {
            const count = node.node.articleIds.length;
            const dotSize = node.depth === 1 ? Math.min(30, 18 + count) : 14;
            const seedDelay = `${hash(node.id) % 2400}ms`;
            return (
              <button
                key={node.id}
                type="button"
                className="evidence-map-node absolute"
                aria-expanded={node.expanded}
                title={
                  node.expanded
                    ? "Collapse"
                    : `Expand ${node.node.label ?? "cluster"} (${count} article${count === 1 ? "" : "s"})`
                }
                style={{
                  left: `${node.x}%`,
                  top: `${node.y}%`,
                  transform: parallax(node),
                  transition:
                    "left var(--duration-slow) var(--ease-out), top var(--duration-slow) var(--ease-out), transform var(--duration-base) var(--ease-out)",
                  zIndex: 10,
                }}
                onClick={() => toggleExpand(node)}
                onMouseEnter={() => setHoveredId(node.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <span
                  className={`${reducedMotion ? "" : "evidence-map-breathe "}mx-auto block rounded-full border`}
                  style={{
                    width: dotSize,
                    height: dotSize,
                    animationDelay: seedDelay,
                    backgroundColor: node.expanded
                      ? "color-mix(in srgb, var(--gold) 30%, transparent)"
                      : "color-mix(in srgb, var(--gold) 14%, transparent)",
                    borderColor:
                      isHovered || isNearest
                        ? "var(--gold)"
                        : "color-mix(in srgb, var(--gold) 55%, transparent)",
                    boxShadow:
                      isHovered || isNearest
                        ? "0 0 0 5px color-mix(in srgb, var(--gold) 18%, transparent)"
                        : "none",
                    transition:
                      "background-color var(--duration-base) var(--ease-out), border-color var(--duration-base) var(--ease-out), box-shadow var(--duration-base) var(--ease-out)",
                  }}
                />
                <span
                  className={`map-leaf-label ${isHovered ? "is-active" : ""} absolute w-[116px] font-sans font-semibold uppercase tracking-[0.1em] ${label.className}`}
                  style={{
                    ...label.style,
                    fontSize: node.depth === 1 ? "9.5px" : "8.5px",
                    color: isHovered || isNearest ? "var(--foreground)" : "var(--text-muted)",
                  }}
                >
                  {node.node.label ?? "···"}
                  {!node.expanded && (
                    <span className="ml-1 font-normal normal-case tracking-normal text-text-faint">
                      · {count}
                    </span>
                  )}
                </span>
              </button>
            );
          }

          // Article leaf: orb + radial label + flip-aware popup.
          const seedDelay = `${hash(node.id) % 2400}ms`;
          return (
            <div
              key={node.id}
              className="evidence-map-node absolute"
              style={{
                left: `${node.x}%`,
                top: `${node.y}%`,
                transform: parallax(node),
                transition:
                  "left var(--duration-slow) var(--ease-out), top var(--duration-slow) var(--ease-out), transform var(--duration-base) var(--ease-out)",
                zIndex: isHovered ? 40 : 10,
              }}
              onMouseEnter={() => setHoveredId(node.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              {/* Orb: gold core with a soft halo ring, breathing. */}
              <div
                className="evidence-map-breathe mx-auto rounded-full"
                style={{
                  width: 12,
                  height: 12,
                  animationDelay: seedDelay,
                  background:
                    "radial-gradient(circle at 35% 35%, color-mix(in srgb, var(--gold) 85%, white), var(--gold))",
                  boxShadow:
                    isHovered || isNearest
                      ? "0 0 0 6px color-mix(in srgb, var(--gold) 26%, transparent), 0 0 18px color-mix(in srgb, var(--gold) 45%, transparent)"
                      : "0 0 0 3px color-mix(in srgb, var(--gold) 10%, transparent)",
                  transform: isHovered ? "scale(1.5)" : isNearest ? "scale(1.22)" : "scale(1)",
                  transition:
                    "transform var(--duration-base) var(--ease-out), box-shadow var(--duration-base) var(--ease-out)",
                }}
              />
              <p
                className={`map-leaf-label ${isHovered ? "is-active" : ""} absolute w-[104px] font-sans text-[9.5px] leading-tight ${label.className}`}
                style={{
                  ...label.style,
                  color: isHovered || isNearest ? "var(--foreground)" : "var(--text-faint)",
                }}
              >
                {truncate(node.article.title, 40)}
              </p>

              {isHovered && (
                <div
                  className="motion-rise-in absolute z-50 w-[236px] rounded-lg border border-border-default bg-background px-3.5 py-3 shadow-lg"
                  style={popupStyle(node)}
                >
                  <p
                    className="text-text-primary"
                    style={{ fontFamily: SERIF, fontSize: "12.5px", fontWeight: 600, lineHeight: 1.35 }}
                  >
                    {node.article.title}
                  </p>
                  <p className="mt-1 font-sans text-[10px] text-text-faint">
                    {node.article.source}
                  </p>
                  <ArticleMemoActions article={node.article} alwaysVisible />
                </div>
              )}
            </div>
          );
        })}

        {/* Legend. */}
        <p className="absolute bottom-3 left-4 z-20 font-sans text-[10px] text-text-faint">
          <span
            aria-hidden
            className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
            style={{
              backgroundColor: "color-mix(in srgb, var(--gold) 30%, transparent)",
              border: "1px solid var(--gold)",
            }}
          />
          Grouped by topic, not by stance. Lines are membership, never support or contradiction.
          <span className="ml-2 text-text-faint/80">Click a cluster to expand it.</span>
        </p>
      </div>
    </div>
  );
}

export default EvidenceMap;

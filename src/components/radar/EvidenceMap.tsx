"use client";

/**
 * EvidenceMap — a multi-level relational graph of matched articles.
 *
 * STRUCTURE: center (the claim/topic) → cluster hubs (sectors of
 * coverage) → optional subsector hubs (finer groupings, produced by
 * re-clustering a cluster's members with the same clusterArticles
 * util) → article leaves. Closeness of relation maps to proximity:
 * the closest-in-relation article sits nearest its parent, the next
 * further out, radiating outward — and every article traces back to
 * the center through its branch.
 *
 * SEMANTICS (honesty): branch lines convey topical relatedness and
 * membership ONLY — never support/contradict/stance. The legend says
 * so, always visible.
 *
 * DENSITY: each branch shows a bounded number of leaves; the rest
 * collapse into an expandable "+N more" orb, so a busy topic stays
 * readable past 15+ articles instead of blurring into a blob. Angular
 * wedges keep branches separated; leaf labels sit radially outward
 * (away from the center) so neighboring labels never collide; while a
 * popup is open all other labels de-emphasize (globals.css
 * [data-popup-open]).
 *
 * LIFE: node dots breathe on a slow seeded loop; nodes gravitate
 * toward the cursor with distance falloff; the nearest node
 * highlights; hover scales/brightens a node and opens the action card
 * (view source, generate memo) positioned OUTWARD from the center
 * where the canvas is empty, edge-clamped so it never clips. All
 * motion uses the shared tokens and fully disables under
 * prefers-reduced-motion.
 *
 * THIN STATE: with too few articles to cluster, matched articles
 * render as proper actionable cards with the honest note.
 */

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { clusterArticles, type Article } from "@/lib/clustering-utils";
import { ArticleMemoActions } from "@/components/radar/ArticleMemoActions";

const SERIF = "var(--font-playfair-display), serif";
const MIN_ARTICLES = 4;
const MAX_CLUSTERS = 6;
const LEAVES_PER_BRANCH = 3; // visible before "+N more"
const EXPANDED_LEAVES = 7;

/** Vertical squash so the ellipse fills a wide canvas gracefully. */
const Y_SQUASH = 0.82;
/** Ring radii (% of canvas) per depth. */
const R_CLUSTER = 19;
const R_LEAF_BASE = 31;
const R_LEAF_STEP = 5.5;
const R_SUBSECTOR = 30;
const R_SUBLEAF_BASE = 41;
const R_SUBLEAF_STEP = 4.5;

type MapArticle = Article & { primary_company?: string | null };

interface LeafNode {
  kind: "leaf";
  id: string;
  article: MapArticle;
  x: number;
  y: number;
  parent: { x: number; y: number };
}
interface MoreNode {
  kind: "more";
  id: string;
  count: number;
  x: number;
  y: number;
  parent: { x: number; y: number };
}
interface HubNode {
  kind: "hub";
  id: string;
  label: string;
  depth: 1 | 2; // cluster | subsector
  x: number;
  y: number;
  parent: { x: number; y: number };
}
type GraphNode = LeafNode | MoreNode | HubNode;

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

/** Deterministic id hash (djb2) for stable jitter/delays; no Math.random. */
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function clusterLabel(articles: MapArticle[]): string {
  const counts = new Map<string, number>();
  for (const a of articles) {
    for (const tag of [...(a.activity_types ?? []), ...(a.industry_verticals ?? [])]) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : "Related coverage";
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

function polar(cx: number, cy: number, r: number, angle: number) {
  return { x: cx + r * Math.cos(angle), y: cy + r * Y_SQUASH * Math.sin(angle) };
}

function clampPos(p: { x: number; y: number }) {
  return { x: Math.min(93, Math.max(7, p.x)), y: Math.min(90, Math.max(10, p.y)) };
}

/**
 * Radial tree layout. Each cluster owns an angular wedge; leaves get
 * evenly spaced slots inside it at increasing radius (closest relation
 * first). Clusters with enough members subdivide into subsectors by
 * re-clustering their members.
 */
function layoutGraph(articles: MapArticle[], expanded: Set<string>): GraphNode[] {
  const center = { x: 50, y: 50 };
  const clusters = clusterArticles(articles).slice(0, MAX_CLUSTERS);
  const n = clusters.length;
  const wedge = ((2 * Math.PI) / n) * 0.76;
  const nodes: GraphNode[] = [];

  clusters.forEach((cluster, i) => {
    const theta = (i / n) * 2 * Math.PI - Math.PI / 2;
    const hubPos = polar(center.x, center.y, R_CLUSTER, theta);
    const members: MapArticle[] = [cluster.leadArticle, ...cluster.relatedArticles];
    const hubId = `hub-${i}`;
    nodes.push({
      kind: "hub",
      id: hubId,
      label: clusterLabel(members),
      depth: 1,
      x: hubPos.x,
      y: hubPos.y,
      parent: center,
    });

    // Finer structure: re-cluster the members among themselves. Two or
    // more genuine subgroups -> subsector level; otherwise flat leaves.
    const subs = members.length >= 5 ? clusterArticles(members) : [];
    const useSubs = subs.length >= 2 && subs.some((s) => s.relatedArticles.length > 0);

    if (!useSubs) {
      placeLeaves(nodes, members, hubId, hubPos, theta, wedge, expanded, false);
      return;
    }

    const subCount = Math.min(subs.length, 3);
    subs.slice(0, subCount).forEach((sub, j) => {
      const subTheta = theta - wedge / 2 + (wedge * (j + 0.5)) / subCount;
      const subPos = polar(center.x, center.y, R_SUBSECTOR, subTheta);
      const subMembers = [sub.leadArticle, ...sub.relatedArticles];
      const subId = `${hubId}-sub-${j}`;
      nodes.push({
        kind: "hub",
        id: subId,
        label: clusterLabel(subMembers),
        depth: 2,
        x: subPos.x,
        y: subPos.y,
        parent: hubPos,
      });
      placeLeaves(nodes, subMembers, subId, subPos, subTheta, wedge / subCount, expanded, true);
    });
    // Members past the subsector cap collapse into the LAST subsector's
    // "+N more" rather than disappearing.
    const shownIds = new Set(
      subs.slice(0, subCount).flatMap((s) => [s.leadArticle.id, ...s.relatedArticles.map((a) => a.id)]),
    );
    const overflow = members.filter((m) => !shownIds.has(m.id));
    if (overflow.length > 0) {
      const moreTheta = theta + wedge / 2 + 0.12;
      const morePos = clampPos(polar(center.x, center.y, R_SUBSECTOR, moreTheta));
      const moreId = `${hubId}-overflow`;
      if (expanded.has(moreId)) {
        placeLeaves(nodes, overflow.slice(0, 4), hubId, morePos, moreTheta, wedge / 3, expanded, true);
      } else {
        nodes.push({ kind: "more", id: moreId, count: overflow.length, x: morePos.x, y: morePos.y, parent: hubPos });
      }
    }
  });

  return nodes;
}

function placeLeaves(
  nodes: GraphNode[],
  members: MapArticle[],
  branchId: string,
  parentPos: { x: number; y: number },
  theta: number,
  wedge: number,
  expanded: Set<string>,
  isSubLevel: boolean,
) {
  const isExpanded = expanded.has(branchId);
  const cap = isExpanded ? EXPANDED_LEAVES : LEAVES_PER_BRANCH;
  const visible = members.slice(0, cap);
  const hidden = members.length - visible.length;
  const slots = visible.length + (hidden > 0 ? 1 : 0);
  const rBase = isSubLevel ? R_SUBLEAF_BASE : R_LEAF_BASE;
  const rStep = isSubLevel ? R_SUBLEAF_STEP : R_LEAF_STEP;

  visible.forEach((article, j) => {
    // Closest-in-relation nearest the parent: radius grows with rank.
    const angle = slots === 1 ? theta : theta - wedge / 2 + (wedge * (j + 0.5)) / slots;
    const pos = clampPos(polar(50, 50, rBase + Math.floor(j / 2) * rStep + (j % 2) * (rStep / 2), angle));
    nodes.push({ kind: "leaf", id: article.id, article, x: pos.x, y: pos.y, parent: parentPos });
  });
  if (hidden > 0) {
    const angle = theta - wedge / 2 + (wedge * (slots - 0.5)) / slots;
    const pos = clampPos(polar(50, 50, rBase + rStep, angle));
    nodes.push({ kind: "more", id: branchId, count: hidden, x: pos.x, y: pos.y, parent: parentPos });
  }
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
}: {
  centerLabel: string;
  articles: MapArticle[];
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const reducedMotion = useReducedMotion();

  const nodes = useMemo(() => layoutGraph(articles, expanded), [articles, expanded]);

  if (articles.length < MIN_ARTICLES) return <ThinState articles={articles} />;

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
  if (cursor && !reducedMotion) {
    let best = 13;
    for (const node of nodes) {
      if (node.kind === "hub") continue;
      const d = Math.hypot(node.x - cursor.x, (node.y - cursor.y) * 0.75);
      if (d < best) {
        best = d;
        nearestId = node.id;
      }
    }
  }

  /* Exaggerated-but-smooth gravitation toward the cursor. */
  const parallax = (node: GraphNode): string => {
    if (!cursor || reducedMotion) return "translate(-50%, -50%)";
    const dx = cursor.x - node.x;
    const dy = cursor.y - node.y;
    const dist = Math.hypot(dx, dy);
    const strength = Math.max(0, 1 - dist / 45) * (node.kind === "hub" ? 5 : 11);
    const norm = dist || 1;
    return `translate(calc(-50% + ${((dx / norm) * strength).toFixed(1)}px), calc(-50% + ${((dy / norm) * strength).toFixed(1)}px))`;
  };

  /* Popup opens OUTWARD (away from center) where the canvas is empty,
     with edge clamps so it never clips the container. */
  const popupStyle = (node: GraphNode): React.CSSProperties => {
    const style: React.CSSProperties = {};
    const nearTop = node.y < 24;
    const nearBottom = node.y > 76;
    const outwardUp = node.y < 50;
    if ((outwardUp && !nearTop) || nearBottom) style.bottom = "calc(100% + 10px)";
    else style.top = "calc(100% + 10px)";
    if (node.x < 18) {
      style.left = 0;
      style.transform = "none";
    } else if (node.x > 82) {
      style.right = 0;
      style.transform = "none";
    } else {
      style.left = "50%";
      style.transform = "translateX(-50%)";
    }
    return style;
  };

  const tall = nodes.length > 18;
  const hovered = nodes.find((n) => n.id === hoveredId);

  return (
    <div className="motion-rise-in">
      <div
        ref={containerRef}
        onMouseMove={onMouseMove}
        onMouseLeave={() => setCursor(null)}
        data-popup-open={hovered ? "true" : "false"}
        className="relative w-full overflow-hidden rounded-xl border border-border-subtle bg-elevated"
        style={{ height: tall ? "680px" : "580px" }}
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
          {nodes.map((node) => (
            <line
              key={`edge-${node.id}`}
              x1={node.parent.x}
              y1={node.parent.y}
              x2={node.x}
              y2={node.y}
              stroke={
                node.kind === "hub"
                  ? "color-mix(in srgb, var(--gold) 32%, transparent)"
                  : "var(--border-hi)"
              }
              strokeWidth={node.kind === "hub" ? 1.4 : 1}
              vector-effect="non-scaling-stroke"
              opacity={hoveredId && node.id !== hoveredId ? 0.35 : 0.8}
              style={{ transition: "opacity var(--duration-base) var(--ease-out)" }}
            />
          ))}
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
          const labelOutward = node.y >= 50;

          if (node.kind === "hub") {
            return (
              <div
                key={node.id}
                className="evidence-map-node pointer-events-none absolute z-10"
                style={{
                  left: `${node.x}%`,
                  top: `${node.y}%`,
                  transform: parallax(node),
                  transition: "transform var(--duration-base) var(--ease-out)",
                }}
              >
                <div
                  className="mx-auto rounded-full border"
                  style={{
                    width: node.depth === 1 ? 20 : 14,
                    height: node.depth === 1 ? 20 : 14,
                    backgroundColor: "color-mix(in srgb, var(--gold) 14%, transparent)",
                    borderColor: "color-mix(in srgb, var(--gold) 55%, transparent)",
                  }}
                />
                <p
                  className={`map-leaf-label absolute left-1/2 w-[110px] -translate-x-1/2 text-center font-sans font-semibold uppercase tracking-[0.1em] text-text-muted ${labelOutward ? "top-full mt-1" : "bottom-full mb-1"}`}
                  style={{ fontSize: node.depth === 1 ? "9.5px" : "8.5px" }}
                >
                  {node.label}
                </p>
              </div>
            );
          }

          if (node.kind === "more") {
            return (
              <button
                key={node.id}
                className="evidence-map-node absolute z-10"
                style={{
                  left: `${node.x}%`,
                  top: `${node.y}%`,
                  transform: parallax(node),
                  transition: "transform var(--duration-base) var(--ease-out)",
                }}
                onClick={() =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    next.add(node.id);
                    return next;
                  })
                }
                title={`Show ${node.count} more articles`}
              >
                <span
                  className="mx-auto flex items-center justify-center rounded-full border border-dashed font-sans text-[9px] font-semibold text-text-muted"
                  style={{
                    width: 26,
                    height: 26,
                    borderColor: "var(--border-strong)",
                    backgroundColor: "var(--background)",
                  }}
                >
                  +{node.count}
                </span>
                <span
                  className={`map-leaf-label absolute left-1/2 w-[70px] -translate-x-1/2 text-center font-sans text-[9px] text-text-faint ${labelOutward ? "top-full mt-0.5" : "bottom-full mb-0.5"}`}
                >
                  more
                </span>
              </button>
            );
          }

          // Article leaf: orb + radial label + outward popup.
          const seedDelay = `${hash(node.id) % 2400}ms`;
          return (
            <div
              key={node.id}
              className="evidence-map-node absolute"
              style={{
                left: `${node.x}%`,
                top: `${node.y}%`,
                transform: parallax(node),
                transition: "transform var(--duration-base) var(--ease-out)",
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
                className={`map-leaf-label ${isHovered ? "is-active" : ""} absolute left-1/2 w-[104px] -translate-x-1/2 text-center font-sans text-[9.5px] leading-tight ${labelOutward ? "top-full mt-1.5" : "bottom-full mb-1.5"}`}
                style={{
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
        </p>
      </div>
    </div>
  );
}

export default EvidenceMap;

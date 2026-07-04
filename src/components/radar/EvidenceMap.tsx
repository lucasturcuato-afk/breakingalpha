"use client";

/**
 * EvidenceMap — the opt-in Level-1 topical cluster map, rebuilt as a
 * rich interactive visualization.
 *
 * SEMANTICS (honesty): grouping conveys topical relatedness ONLY, never
 * support/contradict. There are deliberately NO connector lines to the
 * center: clusters read as grouped constellations inside soft hulls,
 * and the legend states "Grouped by topic, not by stance." Nothing
 * directional is drawn or implied.
 *
 * LAYOUT: deterministic radial arrangement in a padded percentage
 * space; cluster centroids sit on an ellipse around the labeled center
 * claim/topic, member nodes scatter around their centroid with
 * id-seeded jitter. All positions stay inside safe bounds so nothing
 * ever clips, at any cluster count.
 *
 * INTERACTIVITY: the map responds to the cursor (nodes gravitate
 * subtly toward it with distance falloff, the nearest node highlights,
 * a soft gold glow follows the pointer). Hovering a node scales and
 * brightens it and opens a card with title/source and the standard
 * actions (view source, generate memo). All motion uses the shared
 * tokens (--duration-base / --ease-out) and is disabled under
 * prefers-reduced-motion (see globals.css .evidence-map-node/glow).
 *
 * THIN STATE: with too few articles to cluster meaningfully, the
 * matched articles render as proper actionable cards with the honest
 * note that there are not enough yet to map.
 */

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { clusterArticles, type Article } from "@/lib/clustering-utils";
import { ArticleMemoActions } from "@/components/radar/ArticleMemoActions";

/** prefers-reduced-motion, subscription-based (no setState-in-effect). */
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

const SERIF = "var(--font-playfair-display), serif";
const MIN_ARTICLES = 4;
const MAX_CLUSTERS = 6;
const MAX_SATELLITES = 4;

type MapArticle = Article & { primary_company?: string | null };

interface Node {
  article: MapArticle;
  clusterIndex: number;
  isLead: boolean;
  x: number; // 0-100 (%)
  y: number; // 0-100 (%)
}

interface ClusterShape {
  index: number;
  label: string;
  cx: number;
  cy: number;
  extraCount: number;
}

/** Deterministic id hash (djb2) for stable jitter; no Math.random. */
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Most common activity/industry tag in a cluster, else a neutral label. */
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

function layout(articles: MapArticle[]): { nodes: Node[]; clusters: ClusterShape[] } {
  const raw = clusterArticles(articles).slice(0, MAX_CLUSTERS);
  const n = raw.length;
  const nodes: Node[] = [];
  const clusters: ClusterShape[] = [];

  raw.forEach((cluster, i) => {
    // Centroids on an ellipse; radii tuned so hull + labels stay inside
    // the padded bounds at every count.
    const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
    const cx = 50 + (n === 1 ? 0 : 31) * Math.cos(angle);
    const cy = 50 + (n === 1 ? 26 : 27) * Math.sin(angle);
    const members = [cluster.leadArticle, ...cluster.relatedArticles];
    const shown = members.slice(0, 1 + MAX_SATELLITES);

    shown.forEach((article, j) => {
      if (j === 0) {
        nodes.push({ article, clusterIndex: i, isLead: true, x: cx, y: cy });
        return;
      }
      const seed = hash(article.id);
      const satAngle = ((j - 1) / Math.max(1, shown.length - 1)) * 2 * Math.PI + (seed % 100) / 100;
      const satR = 7.5 + (seed % 3);
      nodes.push({
        article,
        clusterIndex: i,
        isLead: false,
        x: Math.min(92, Math.max(8, cx + satR * Math.cos(satAngle))),
        y: Math.min(88, Math.max(12, cy + satR * 0.85 * Math.sin(satAngle))),
      });
    });

    clusters.push({
      index: i,
      label: clusterLabel(members),
      cx,
      cy,
      extraCount: members.length - shown.length,
    });
  });

  return { nodes, clusters };
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
  const reducedMotion = useReducedMotion();

  const { nodes, clusters } = useMemo(() => layout(articles), [articles]);

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

  // Nearest node to the cursor gently highlights.
  let nearestId: string | null = null;
  if (cursor && !reducedMotion) {
    let best = 14; // only within a sensible radius (%)
    for (const node of nodes) {
      const d = Math.hypot(node.x - cursor.x, (node.y - cursor.y) * 0.75);
      if (d < best) {
        best = d;
        nearestId = node.article.id;
      }
    }
  }

  const parallax = (node: Node): string => {
    if (!cursor || reducedMotion) return "translate(-50%, -50%)";
    const dx = cursor.x - node.x;
    const dy = cursor.y - node.y;
    const dist = Math.hypot(dx, dy);
    const strength = Math.max(0, 1 - dist / 40) * 6; // px, distance falloff
    const norm = dist || 1;
    return `translate(calc(-50% + ${((dx / norm) * strength).toFixed(1)}px), calc(-50% + ${((dy / norm) * strength).toFixed(1)}px))`;
  };

  return (
    <div className="motion-rise-in">
      <div
        ref={containerRef}
        onMouseMove={onMouseMove}
        onMouseLeave={() => setCursor(null)}
        className="relative w-full overflow-hidden rounded-xl border border-border-subtle bg-elevated"
        style={{ height: clusters.length > 4 ? "620px" : "540px" }}
      >
        {/* Cursor-following glow: soft, structural, never a link. */}
        {cursor && !reducedMotion && (
          <div
            aria-hidden
            className="evidence-map-glow pointer-events-none absolute h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              left: `${cursor.x}%`,
              top: `${cursor.y}%`,
              background:
                "radial-gradient(circle, color-mix(in srgb, var(--gold) 12%, transparent) 0%, transparent 70%)",
              transition: `left var(--duration-base) var(--ease-out), top var(--duration-base) var(--ease-out)`,
            }}
          />
        )}

        {/* Cluster hulls: soft topical groupings, labeled. */}
        {clusters.map((c) => (
          <div
            key={c.index}
            aria-hidden
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-[45%]"
            style={{
              left: `${c.cx}%`,
              top: `${c.cy}%`,
              width: "24%",
              height: "34%",
              minWidth: "180px",
              minHeight: "150px",
              background: "color-mix(in srgb, var(--gold) 5%, transparent)",
              border: "1px solid color-mix(in srgb, var(--gold) 18%, transparent)",
            }}
          />
        ))}
        {clusters.map((c) => (
          <span
            key={`label-${c.index}`}
            className="pointer-events-none absolute -translate-x-1/2 font-sans text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted"
            style={{ left: `${c.cx}%`, top: `calc(${c.cy}% - 17.5%)` }}
          >
            {c.label}
            {c.extraCount > 0 && (
              <span className="ml-1 font-normal text-text-faint">+{c.extraCount} more</span>
            )}
          </span>
        ))}

        {/* Center: the claim/topic, clearly labeled. */}
        <div
          className="absolute z-20 max-w-[240px] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-espresso px-4 py-3 text-center text-cream shadow-md dark:border dark:border-border-default dark:bg-overlay"
          style={{ left: "50%", top: "50%" }}
        >
          <p className="font-sans text-[9px] font-semibold uppercase tracking-[0.16em] text-cream/60 dark:text-text-faint">
            Claim / topic
          </p>
          <p
            className="mt-1"
            style={{
              fontFamily: SERIF,
              fontSize: "13px",
              fontWeight: 600,
              lineHeight: 1.35,
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {centerLabel}
          </p>
        </div>

        {/* Article nodes: dot + label, parallax toward cursor, hover card. */}
        {nodes.map((node) => {
          const isHovered = hoveredId === node.article.id;
          const isNearest = nearestId === node.article.id;
          const popBelow = node.y < 34;
          return (
            <div
              key={node.article.id}
              className="evidence-map-node absolute"
              style={{
                left: `${node.x}%`,
                top: `${node.y}%`,
                transform: parallax(node),
                transition: `transform var(--duration-base) var(--ease-out)`,
                zIndex: isHovered ? 40 : 10,
              }}
              onMouseEnter={() => setHoveredId(node.article.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <div
                className="mx-auto rounded-full"
                style={{
                  width: node.isLead ? 13 : 9,
                  height: node.isLead ? 13 : 9,
                  backgroundColor: node.isLead ? "var(--gold)" : "var(--text-muted)",
                  boxShadow:
                    isHovered || isNearest
                      ? "0 0 0 5px color-mix(in srgb, var(--gold) 25%, transparent)"
                      : "none",
                  transform: isHovered ? "scale(1.35)" : isNearest ? "scale(1.15)" : "scale(1)",
                  transition: `transform var(--duration-base) var(--ease-out), box-shadow var(--duration-base) var(--ease-out)`,
                }}
              />
              <p
                className="mt-1 w-[120px] -translate-x-1/2 text-center font-sans text-[10px] leading-tight"
                style={{
                  marginLeft: "50%",
                  color: isHovered || isNearest ? "var(--foreground)" : "var(--text-faint)",
                  transition: `color var(--duration-base) var(--ease-out)`,
                }}
              >
                {truncate(node.article.title, 42)}
              </p>

              {isHovered && (
                <div
                  className="motion-rise-in absolute left-1/2 z-50 w-[240px] -translate-x-1/2 rounded-lg border border-border-default bg-background px-3.5 py-3 shadow-lg"
                  style={popBelow ? { top: "calc(100% + 8px)" } : { bottom: "calc(100% + 8px)" }}
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

        {/* Legend: the honest semantics, always visible. */}
        <p className="absolute bottom-3 left-4 font-sans text-[10px] text-text-faint">
          <span aria-hidden className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: "color-mix(in srgb, var(--gold) 30%, transparent)", border: "1px solid var(--gold)" }} />
          Grouped by topic, not by stance. No support/contradict links are drawn.
        </p>
      </div>
    </div>
  );
}

export default EvidenceMap;

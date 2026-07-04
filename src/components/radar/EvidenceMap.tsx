"use client";

/**
 * EvidenceMap — the opt-in Level-1 topical cluster map. The claim/topic
 * sits at center; related articles cluster around it by topical
 * relatedness using the EXISTING clusterArticles util (title Jaccard).
 *
 * HONESTY: clustering is topical only. No support/contradict links are
 * fabricated or drawn, and the map says so. With too few articles to
 * cluster meaningfully the map declines to render and says why (the
 * caller keeps the list view). Every node is fully actionable: view
 * source + generate memo, via the same hover affordance as the feeds.
 */

import { clusterArticles, type Article } from "@/lib/clustering-utils";
import { ArticleMemoActions } from "@/components/radar/ArticleMemoActions";

const SERIF = "var(--font-playfair-display), serif";
const MIN_ARTICLES = 4;

export function EvidenceMap({
  centerLabel,
  articles,
}: {
  centerLabel: string;
  articles: (Article & { primary_company?: string | null })[];
}) {
  if (articles.length < MIN_ARTICLES) {
    return (
      <div className="rounded-lg border border-border-subtle bg-elevated px-4 py-4">
        <p className="font-sans text-[13px] text-text-muted">
          Only {articles.length} matched article{articles.length === 1 ? "" : "s"};
          too few to cluster meaningfully. The list is the honest view here.
        </p>
      </div>
    );
  }

  const clusters = clusterArticles(articles).slice(0, 6);
  const n = clusters.length;

  // Radial slots: hub i at angle offset around the center.
  const hubPos = (i: number) => {
    const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
    return {
      left: `${50 + 38 * Math.cos(angle)}%`,
      top: `${50 + 38 * Math.sin(angle)}%`,
    };
  };

  return (
    <div>
      <p className="mb-2 font-sans text-[11px] text-text-faint">
        Clustered by topical relatedness only; no support/contradict links are
        drawn or implied.
      </p>
      <div className="relative h-[540px] w-full overflow-hidden rounded-xl border border-border-subtle bg-elevated">
        {/* Spokes: center -> hub, purely structural. */}
        <svg
          aria-hidden
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {clusters.map((_, i) => {
            const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
            return (
              <line
                key={i}
                x1="50"
                y1="50"
                x2={50 + 38 * Math.cos(angle)}
                y2={50 + 38 * Math.sin(angle)}
                stroke="var(--border-hi)"
                strokeWidth="0.3"
              />
            );
          })}
        </svg>

        {/* Center node: the claim/topic. */}
        <div
          className="absolute z-10 max-w-[220px] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-espresso px-4 py-3 text-center text-cream dark:border dark:border-border-default dark:bg-overlay"
          style={{ left: "50%", top: "50%" }}
        >
          <p style={{ fontFamily: SERIF, fontSize: "14px", fontWeight: 600, lineHeight: 1.3 }}>
            {centerLabel}
          </p>
        </div>

        {/* Cluster hubs. */}
        {clusters.map((cluster, i) => {
          const pos = hubPos(i);
          return (
            <div
              key={cluster.id}
              className="group absolute z-10 w-[220px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border-default bg-background px-3 py-2.5 shadow-sm"
              style={pos}
            >
              <p
                className="text-text-primary"
                style={{ fontFamily: SERIF, fontSize: "12px", fontWeight: 600, lineHeight: 1.35 }}
              >
                {cluster.leadArticle.title}
              </p>
              <p className="mt-1 font-sans text-[10px] text-text-faint">
                {cluster.leadArticle.source}
                {cluster.relatedArticles.length > 0 &&
                  ` · +${cluster.relatedArticles.length} related`}
              </p>
              <ArticleMemoActions article={cluster.leadArticle} />
              {cluster.relatedArticles.slice(0, 2).map((rel) => (
                <div key={rel.id} className="group/rel mt-1.5 border-t border-border-subtle pt-1.5">
                  <p className="font-sans text-[11px] leading-snug text-text-secondary">
                    {rel.title}
                  </p>
                  <ArticleMemoActions article={rel} alwaysVisible={false} />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default EvidenceMap;

/**
 * SourcesStrip -- bottom-row tier-grouped strip of the top-5 sources cited
 * in the current company-detail view.
 *
 * Aggregation caveat (W2-C / PR-C5): the strip aggregates ONLY from the
 * articles array passed in by the page (top-12 today, see ARTICLE_LIMIT in
 * src/lib/data-access/getCompanyDetail.ts). It does NOT scan the full DB
 * pool. A W2-D follow-up may extend this to the full pool if requested.
 *
 * Layout: three tier wrappers (`sources-tier-1|2|3`) each contain their
 * subset of the top-5 entries. Empty wrappers are omitted; if the entire
 * articles list is empty the empty-state row renders instead.
 */

import type { CSSProperties } from "react";
import { classifyTier, type Tier } from "@/lib/sources/tierMap";

interface SourcesStripArticle { source?: string | null }
interface SourcesStripProps { articles: ReadonlyArray<SourcesStripArticle> }

interface AggRow { source: string; count: number; tier: Tier }

const MONO = "var(--font-mono), ui-monospace, monospace";
const FAINT = "var(--text-faint)";

const S: Record<string, CSSProperties> = {
  card: { background: "var(--cream-hi)", border: "1px solid var(--border-base)", borderRadius: 8, padding: "11px 14px", display: "flex", flexDirection: "column", gap: 8 },
  header: { display: "flex", alignItems: "baseline", justifyContent: "space-between" },
  title: { fontFamily: "var(--font-display), serif", fontSize: 13, fontWeight: 700, color: "var(--text-primary)", margin: 0 },
  hint: { fontFamily: MONO, fontSize: 10, color: FAINT },
  tierRow: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 },
  tierLabel: { fontFamily: MONO, fontSize: 9, fontWeight: 700, color: FAINT, letterSpacing: "0.08em", textTransform: "uppercase", marginRight: 4 },
  pill: { display: "inline-flex", alignItems: "baseline", gap: 6, padding: "3px 8px", borderRadius: 999, border: "1px solid var(--border-base)", background: "var(--cream)", fontFamily: MONO, fontSize: 11, color: "var(--text-primary)" },
  pillCount: { color: FAINT, fontVariantNumeric: "tabular-nums" },
  empty: { fontFamily: "var(--font-sans), sans-serif", fontSize: 12, color: FAINT, textAlign: "center", padding: "8px 0" },
};

function aggregate(articles: ReadonlyArray<SourcesStripArticle>): AggRow[] {
  const counts = new Map<string, number>();
  for (const a of articles) {
    const s = a.source?.trim();
    if (!s) continue;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const rows: AggRow[] = Array.from(counts, ([source, count]) => ({ source, count, tier: classifyTier(source) }));
  rows.sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
  return rows.slice(0, 5);
}

export function SourcesStrip({ articles }: SourcesStripProps) {
  const top = aggregate(articles);
  const isEmpty = top.length === 0;

  return (
    <div data-testid="sources-strip" style={S.card}>
      <div style={S.header}>
        <h3 style={S.title}>Sources</h3>
        <span style={S.hint}>top {top.length} of {articles.length}</span>
      </div>
      {isEmpty ? (
        <div data-testid="sources-empty-state" style={S.empty}>No sources cited yet</div>
      ) : (
        <>
          {([1, 2, 3] as Tier[]).map((tier) => {
            const rows = top.filter((r) => r.tier === tier);
            if (rows.length === 0) return null;
            return (
              <div key={tier} data-testid={`sources-tier-${tier}`} style={S.tierRow}>
                <span style={S.tierLabel}>T{tier}</span>
                {rows.map((r) => (
                  <span key={r.source} data-testid="sources-strip-item" style={S.pill}>
                    <span>{r.source}</span>
                    <span style={S.pillCount}>{r.count}</span>
                  </span>
                ))}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

/**
 * SourcesTab -- F5 tab content for the company detail page.
 *
 * Renders one row per distinct source cited by the passed-in articles,
 * sorted by article count desc then source name asc. Each row carries
 * its credibility tier (1 / 2 / 3) computed via classifyTier().
 *
 * Aggregation caveat (W2-C / PR-C5): consumes ONLY the articles array
 * the page hands down. Mirrors the SourcesStrip caveat -- top-12 today,
 * not the full DB pool.
 */

import type { CSSProperties } from "react";
import { classifyTier, type Tier } from "@/lib/sources/tierMap";

interface SourcesTabArticle { source?: string | null }
interface SourcesTabProps { articles: ReadonlyArray<SourcesTabArticle> }

interface SourceRow { source: string; count: number; tier: Tier }

const MONO = "var(--font-mono), ui-monospace, monospace";
const SANS = "var(--font-sans), sans-serif";
const FAINT = "var(--text-faint)";

const S: Record<string, CSSProperties> = {
  card: { background: "var(--cream-hi)", border: "1px solid var(--border-base)", borderRadius: 8, overflow: "hidden" },
  header: { padding: "11px 14px", borderBottom: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", gap: 8 },
  title: { fontFamily: "var(--font-display), serif", fontSize: 14, fontWeight: 700, color: "var(--text-primary)", margin: 0 },
  count: { fontFamily: MONO, fontSize: 10, color: FAINT, marginLeft: "auto" },
  empty: { padding: 16, textAlign: "center", fontFamily: SANS, fontSize: 12, color: FAINT },
  row: { display: "grid", gridTemplateColumns: "32px 1fr 48px 56px", gap: 10, padding: "8px 14px", alignItems: "center" },
  ordinal: { fontFamily: MONO, fontSize: 9.5, color: FAINT, fontVariantNumeric: "tabular-nums" },
  source: { fontFamily: SANS, fontSize: 12, color: "var(--text-primary)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  rowCount: { fontFamily: MONO, fontSize: 10.5, color: "var(--text-secondary)", textAlign: "right", fontVariantNumeric: "tabular-nums" },
  tierBadge: { fontFamily: MONO, fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 999, textAlign: "center", letterSpacing: "0.06em", border: "1px solid var(--border-base)", background: "var(--cream)", color: "var(--text-secondary)" },
};

function aggregate(articles: ReadonlyArray<SourcesTabArticle>): SourceRow[] {
  const counts = new Map<string, number>();
  for (const a of articles) {
    const s = a.source?.trim();
    if (!s) continue;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const rows: SourceRow[] = Array.from(counts, ([source, count]) => ({ source, count, tier: classifyTier(source) }));
  rows.sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
  return rows;
}

const rowStyle = (i: number): CSSProperties => ({
  ...S.row,
  borderTop: i === 0 ? "none" : "1px solid var(--border-subtle)",
});

export function SourcesTab({ articles }: SourcesTabProps) {
  const rows = aggregate(articles);
  const isEmpty = rows.length === 0;

  return (
    <div data-testid="sources-tab" style={S.card}>
      <div style={S.header}>
        <h3 style={S.title}>Sources</h3>
        <span style={S.count}>{rows.length} distinct</span>
      </div>
      {isEmpty ? (
        <div data-testid="sources-empty-state" style={S.empty}>No sources cited yet</div>
      ) : (
        <div>
          {rows.map((r, i) => (
            <div key={r.source} data-testid="sources-tab-row" style={rowStyle(i)}>
              <span style={S.ordinal}>{String(i + 1).padStart(2, "0")}</span>
              <span style={S.source}>{r.source}</span>
              <span style={S.tierBadge}>T{r.tier}</span>
              <span style={S.rowCount}>{r.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

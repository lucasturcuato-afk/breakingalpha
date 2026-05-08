/** ThemesTab -- expanded Themes view (top 15) with per-row sub-articles
 *  and an 8d frequency sparkline. Recon: phase-5-recon/pr-c3.md. */

import type { CSSProperties } from "react";
import { deriveThemes } from "@/lib/data-access/deriveThemes";
import type { CompanyDetailArticle } from "@/lib/data-access/getCompanyDetail";
import { ThemesDetailRow } from "@/components/company/ThemesDetailRow";

const SPARK_DAYS = 8;
const DAY_MS = 86_400_000;
const TAB_LIMIT = 15;
const FAINT = "var(--text-faint)";

interface ThemesTabProps { themes: ReadonlyArray<string>; articles: ReadonlyArray<CompanyDetailArticle>; }

const S: Record<string, CSSProperties> = {
  card: { background: "var(--cream-hi)", border: "1px solid var(--border-base)", borderRadius: 8, overflow: "hidden" },
  header: { padding: "11px 14px", borderBottom: "1px solid var(--border-subtle)", display: "flex", alignItems: "center" },
  title: { fontFamily: "var(--font-display), serif", fontSize: 14, fontWeight: 700, margin: 0, color: "var(--text-primary)" },
  count: { fontFamily: "var(--font-mono), monospace", fontSize: 10, color: FAINT },
  empty: { padding: 16, textAlign: "center", fontFamily: "var(--font-sans), sans-serif", fontSize: 12, color: FAINT },
};

function utcDayMs(iso: string): number { const x = new Date(iso); x.setUTCHours(0, 0, 0, 0); return x.getTime(); }

export function matchArticlesForTheme(label: string, articles: ReadonlyArray<CompanyDetailArticle>): CompanyDetailArticle[] {
  const needle = label.toLowerCase();
  return articles.filter((a) => a.title.toLowerCase().includes(needle));
}

function bucket8d(matched: ReadonlyArray<CompanyDetailArticle>): number[] {
  const sinceDay = utcDayMs(new Date(Date.now() - (SPARK_DAYS - 1) * DAY_MS).toISOString());
  const buckets = new Array<number>(SPARK_DAYS).fill(0);
  for (const a of matched) {
    if (!a.publishedAt) continue;
    const idx = Math.floor((utcDayMs(a.publishedAt) - sinceDay) / DAY_MS);
    if (idx >= 0 && idx < SPARK_DAYS) buckets[idx] += 1;
  }
  return buckets;
}

export function ThemesTab({ themes, articles }: ThemesTabProps) {
  const rows = deriveThemes(themes, articles.map((a) => ({ title: a.title, sentiment: a.sentiment })), TAB_LIMIT);
  const isEmpty = rows.length === 0 || rows.every((r) => r.count === 0);
  return (
    <div data-testid="themes-tab" style={S.card}>
      <div style={S.header}>
        <h3 style={S.title}>Themes</h3>
        <span style={{ flex: 1 }} />
        <span style={S.count}>{rows.length} extracted</span>
      </div>
      {isEmpty ? (
        <div data-testid="themes-empty-state" style={S.empty}>No themes derived yet</div>
      ) : (
        <div>
          {rows.map((t, i) => {
            const matched = matchArticlesForTheme(t.label, articles);
            return <ThemesDetailRow key={t.label} index={i} theme={t} matched={matched} sparkValues={bucket8d(matched)} />;
          })}
        </div>
      )}
    </div>
  );
}

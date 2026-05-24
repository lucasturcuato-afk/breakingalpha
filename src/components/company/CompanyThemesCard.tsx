/**
 * CompanyThemesCard -- right-rail Themes card. Renders up to 6 ordinal
 * rows of derived themes (label + weight bar + count + SentimentPill xs)
 * with empty-state when no matches. Visual ref docs/DirectionD.jsx
 * lines 735-761; recon at .session-artifacts/phase-4-recon/pr-b3.md.
 */

import type { CSSProperties } from "react";
import { SentimentPill } from "@/components/ui/sentiment-pill";
import { deriveThemes, type DerivedTheme } from "@/lib/data-access/deriveThemes";

interface ThemesCardArticle { title: string; sentiment: string | null }

interface CompanyThemesCardProps {
  themes: ReadonlyArray<string>;
  articles: ReadonlyArray<ThemesCardArticle>;
}

const GRID = "16px 1fr 70px 36px 56px";
const MONO = "var(--font-mono), monospace";
const SANS = "var(--font-sans), sans-serif";
const FAINT = "var(--text-faint)";

const S: Record<string, CSSProperties> = {
  card: { background: "var(--cream-hi)", border: "1px solid var(--border-base)", borderRadius: 8, overflow: "hidden" },
  header: { padding: "11px 14px", borderBottom: "1px solid var(--border-subtle)", display: "flex", alignItems: "center" },
  title: { fontFamily: "var(--font-display), serif", fontSize: 14, fontWeight: 700, margin: 0, color: "var(--text-primary)" },
  count: { fontFamily: MONO, fontSize: 10, color: FAINT },
  empty: { padding: 16, textAlign: "center", fontFamily: SANS, fontSize: 12, color: FAINT },
  ordinal: { fontFamily: MONO, fontSize: 9.5, color: FAINT, fontVariantNumeric: "tabular-nums" },
  label: { fontFamily: SANS, fontSize: 12, color: "var(--text-primary)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  barTrack: { height: 4, background: "var(--cream)", borderRadius: 2, overflow: "hidden", position: "relative" },
  rowCount: { fontFamily: MONO, fontSize: 10.5, color: "var(--text-secondary)", textAlign: "right", fontVariantNumeric: "tabular-nums" },
};

const rowStyle = (i: number): CSSProperties => ({
  display: "grid", gridTemplateColumns: GRID, gap: 10, padding: "7px 14px", alignItems: "center",
  borderTop: i === 0 ? "none" : "1px solid var(--border-subtle)",
});

export function CompanyThemesCard({ themes, articles }: CompanyThemesCardProps) {
  const rows = deriveThemes(themes, articles);
  const isEmpty = rows.length === 0 || rows.every((r) => r.count === 0);

  return (
    <div data-testid="themes-card-rail" style={S.card}>
      <div style={S.header}>
        <h3 style={S.title}>Themes</h3>
        <span style={{ flex: 1 }} />
        <span style={S.count}>{rows.length} extracted</span>
      </div>
      {isEmpty ? (
        <div data-testid="themes-empty-state" style={S.empty}>No themes derived yet</div>
      ) : (
        <div>{rows.map((t, i) => <ThemeRow key={t.label} theme={t} index={i} />)}</div>
      )}
    </div>
  );
}

function ThemeRow({ theme, index }: { theme: DerivedTheme; index: number }) {
  const ordinal = String(index + 1).padStart(2, "0");
  const fillWidth = `${Math.max(0, Math.min(1, theme.weight)) * 100}%`;
  return (
    <div data-testid="theme-row" style={rowStyle(index)}>
      <span style={S.ordinal}>{ordinal}</span>
      <span data-testid="theme-row-label" style={S.label}>{theme.label}</span>
      <div style={S.barTrack}>
        <div
          data-testid="theme-row-weight-bar theme-weight"
          style={{ position: "absolute", inset: 0, width: fillWidth, background: "var(--gold)", borderRadius: 2 }}
        />
      </div>
      <span data-testid="theme-row-count theme-count" style={S.rowCount}>{theme.count}</span>
      <SentimentPill tone={theme.tone} size="xs" testId="theme-row-sentiment-chip theme-sentiment" />
    </div>
  );
}

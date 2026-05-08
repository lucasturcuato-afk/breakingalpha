"use client";

/** ThemesDetailRow -- collapsible row used by ThemesTab. Collapsed view
 *  mirrors CompanyThemesCard; expanded panel shows matched articles +
 *  an 8d frequency sparkline. */

import { useState, type CSSProperties } from "react";
import { SentimentPill } from "@/components/ui/sentiment-pill";
import { Sparkline } from "@/components/ui/sparkline";
import type { DerivedTheme } from "@/lib/data-access/deriveThemes";
import type { CompanyDetailArticle } from "@/lib/data-access/getCompanyDetail";

interface ThemesDetailRowProps {
  index: number;
  theme: DerivedTheme;
  matched: ReadonlyArray<CompanyDetailArticle>;
  sparkValues: number[];
}

const MONO = "var(--font-mono), monospace";
const SANS = "var(--font-sans), sans-serif";
const FAINT = "var(--text-faint)";
const SUB = "1px solid var(--border-subtle)";
const LINK: CSSProperties = { color: "inherit", textDecoration: "none" };

const S: Record<string, CSSProperties> = {
  btn: { display: "grid", gridTemplateColumns: "16px 1fr 70px 36px 56px 14px", gap: 10, padding: "7px 14px", alignItems: "center", width: "100%", textAlign: "left", background: "transparent", border: "none", cursor: "pointer" },
  ordinal: { fontFamily: MONO, fontSize: 9.5, color: FAINT, fontVariantNumeric: "tabular-nums" },
  label: { fontFamily: SANS, fontSize: 12, color: "var(--text-primary)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  bar: { height: 4, background: "var(--cream)", borderRadius: 2, overflow: "hidden", position: "relative" },
  count: { fontFamily: MONO, fontSize: 10.5, color: "var(--text-secondary)", textAlign: "right", fontVariantNumeric: "tabular-nums" },
  chev: { fontFamily: MONO, fontSize: 10, color: FAINT, textAlign: "right" },
  panel: { padding: "10px 14px 14px", background: "var(--cream)", borderTop: SUB },
  head: { display: "flex", alignItems: "center", gap: 12, marginBottom: 8 },
  hLabel: { fontFamily: MONO, fontSize: 9.5, color: FAINT, letterSpacing: "0.08em", textTransform: "uppercase" },
  list: { listStyle: "none", margin: 0, padding: 0 },
  item: { padding: "5px 0", fontFamily: SANS, fontSize: 12, color: "var(--text-primary)", borderTop: SUB },
  empty: { fontFamily: SANS, fontSize: 12, color: FAINT, padding: "4px 0" },
};

export function ThemesDetailRow({ index, theme, matched, sparkValues }: ThemesDetailRowProps) {
  const [open, setOpen] = useState(false);
  const ordinal = String(index + 1).padStart(2, "0");
  const fillWidth = `${Math.max(0, Math.min(1, theme.weight)) * 100}%`;
  const panelId = `themes-detail-panel-${index}`;
  return (
    <div data-testid="themes-detail-row" style={{ borderTop: index === 0 ? "none" : SUB }}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
        style={S.btn}
      >
        <span style={S.ordinal}>{ordinal}</span>
        <span data-testid="themes-detail-label" style={S.label}>{theme.label}</span>
        <div style={S.bar}><div style={{ position: "absolute", inset: 0, width: fillWidth, background: "var(--gold)", borderRadius: 2 }} /></div>
        <span style={S.count}>{theme.count}</span>
        <SentimentPill tone={theme.tone} size="xs" />
        <span aria-hidden style={S.chev}>{open ? "v" : ">"}</span>
      </button>
      {open && (
        <div id={panelId} style={S.panel}>
          <div style={S.head}>
            <span style={S.hLabel}>8d frequency</span>
            <Sparkline values={sparkValues} w={120} h={28} testId="themes-detail-trend-spark" />
          </div>
          <ul data-testid="themes-detail-articles" style={S.list}>
            {matched.length === 0 ? (
              <li style={S.empty}>No matching articles</li>
            ) : matched.map((a) => (
              <li key={a.id} style={S.item}>{a.url ? <a href={a.url} target="_blank" rel="noreferrer" style={LINK}>{a.title}</a> : a.title}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

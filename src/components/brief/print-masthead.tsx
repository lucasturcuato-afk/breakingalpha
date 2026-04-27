/**
 * PrintMasthead — the gold-to-espresso band + stats strip that sits
 * atop the Morning Brief and Evening Wrap pages.
 *
 * Mirrors the inline JSX currently rendered at:
 *   src/app/morning-brief/page.tsx:482–573
 *   src/app/evening-wrap/page.tsx (identical treatment)
 *
 * Extracted here so the Puppeteer print route renders a 1:1 copy of
 * the masthead without importing the two "use client" brief pages
 * (which mount AppShell + hooks + Supabase clients).
 *
 * Colours are pinned to literal hexes — same pattern the live pages
 * use to keep the masthead consistent across light / dark theme flips.
 */

import { formatPTStamp } from "@/lib/format-pt";

const HERITAGE_GOLD = "#d4a84b";
const DC_ESPRESSO = "#1a1208";
const DC_CREAM = "#fffdf9";

export type PrintMastheadKind = "morning" | "evening";

export interface PrintMastheadProps {
  kind: PrintMastheadKind;
  /** ISO timestamp of briefing creation. Used for "Generated …" stamp. */
  generatedAtIso?: string | null;
  /** Pre-formatted "Thursday, April 23" — falls back to today in PT. */
  dateStr: string;
  /** Pre-formatted "8:27 PM PT" — falls back to now in PT. */
  timeStr: string;
  /** Market Pulse sentiment word, ALL-CAPS for the stats strip. */
  moodWord: string;
  /** Tone classification — drives the MOOD cell's colour. */
  tone: "BULLISH" | "BEARISH" | "MIXED" | "WATCH" | "NEUTRAL";
  /** Story count — rendered as the STORIES stat. */
  storyCount: number;
  /** Active thesis count, or null when unknown. */
  thesesCount: number | null;
  /** Optional VIX snapshot. null when the quote API fails server-side. */
  vix: { price: string; pct: number } | null;
}

const KIND_COPY: Record<PrintMastheadKind, {
  title: string;
  tagline: string;
  readMinutes: string;
}> = {
  morning: {
    title: "Morning Brief",
    tagline: "A considered reading of overnight markets — in four chapters.",
    readMinutes: "4 MIN READ",
  },
  evening: {
    title: "Evening Wrap",
    tagline: "The day's signals, clean-closed for tomorrow's open.",
    readMinutes: "4 MIN READ",
  },
};

function moodColor(tone: PrintMastheadProps["tone"]): string {
  if (tone === "BEARISH") return "var(--signal-dn)";
  if (tone === "BULLISH") return "var(--signal-up)";
  if (tone === "MIXED" || tone === "WATCH") return "var(--signal-warn)";
  return "var(--espresso)";
}

export function PrintMasthead({
  kind,
  generatedAtIso,
  dateStr,
  timeStr,
  moodWord,
  tone,
  storyCount,
  thesesCount,
  vix,
}: PrintMastheadProps) {
  const copy = KIND_COPY[kind];
  const stamp = formatPTStamp(generatedAtIso);

  const stats: { k: string; v: string; c?: string }[] = [
    { k: "MOOD", v: String(moodWord).toUpperCase(), c: moodColor(tone) },
    { k: "STORIES", v: String(storyCount || "—") },
    {
      k: "THESES",
      v: thesesCount !== null ? `${thesesCount} active` : "—",
    },
    {
      k: "VIX",
      v: vix
        ? `${vix.price} ${vix.pct >= 0 ? "▲" : "▼"}${Math.abs(vix.pct).toFixed(2)}%`
        : "—",
      c: vix
        ? vix.pct >= 0
          ? "var(--signal-dn)"
          : "var(--signal-up)"
        : undefined,
    },
  ];

  return (
    <>
      <header
        style={{
          background: `linear-gradient(90deg, ${HERITAGE_GOLD} 0%, ${HERITAGE_GOLD} 30%, ${DC_ESPRESSO} 75%, ${DC_ESPRESSO} 100%)`,
          padding: "14px 32px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 20 }}>
          <span
            className="font-[family-name:var(--font-playfair-display)]"
            style={{
              fontSize: 26,
              fontWeight: 700,
              color: DC_CREAM,
              letterSpacing: "-0.01em",
              lineHeight: 1,
            }}
          >
            Signal<span style={{ color: DC_ESPRESSO }}>era</span>
          </span>
          <span
            style={{
              width: 1,
              height: 20,
              background: "rgba(26,18,8,0.25)",
              alignSelf: "center",
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
            <span
              className="font-[family-name:var(--font-playfair-display)]"
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: DC_CREAM,
                letterSpacing: "-0.01em",
              }}
            >
              {copy.title}
            </span>
            <span
              className="font-[family-name:var(--font-playfair-display)] italic"
              style={{
                fontSize: 13,
                color: "rgba(255,253,249,0.78)",
                marginTop: 4,
                fontWeight: 400,
              }}
            >
              {copy.tagline}
            </span>
          </div>
        </div>
        <div
          className="font-sans"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 22,
            fontSize: 11,
            color: "rgba(255,253,249,0.85)",
            fontWeight: 600,
          }}
        >
          <span>{dateStr}</span>
          <span className="font-data">{timeStr}</span>
          <span
            style={{
              background: "rgba(255,253,249,0.15)",
              color: "rgba(255,253,249,0.9)",
              padding: "4px 10px",
              borderRadius: 20,
              fontSize: 10,
              letterSpacing: "0.12em",
            }}
          >
            {copy.readMinutes}
          </span>
        </div>
      </header>

      {/* Stats metadata bar */}
      <div
        style={{
          padding: "14px 32px",
          borderBottom: "1px solid var(--border-base)",
          background: "var(--cream)",
          display: "flex",
          alignItems: "center",
          gap: 36,
          flexWrap: "wrap",
        }}
      >
        {stats.map((x, i) => (
          <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span
              className="font-sans"
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.16em",
                color: "var(--text-muted)",
              }}
            >
              {x.k}
            </span>
            <span
              className="font-data"
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: x.c || "var(--espresso)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {x.v}
            </span>
          </div>
        ))}
        <span style={{ flex: 1 }} />
        <span
          className="font-data"
          style={{
            fontSize: 10,
            color: "var(--text-muted)",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {stamp ? `Generated ${stamp}` : "Signalera Desk"}
        </span>
      </div>
    </>
  );
}

export default PrintMasthead;

/**
 * PrintBrief — server-safe renderer for the Puppeteer PDF path.
 *
 * This component is intentionally a self-contained server component
 * (no "use client" directive, no hooks, no Supabase browser client,
 * no router). It's rendered by `/print/[briefing_id]/page.tsx` which
 * Puppeteer navigates to from inside `/api/brief/export-pdf`.
 *
 * Design intent (spec Section 4):
 *   - 1:1 visual fidelity with the live Morning Brief and Evening Wrap
 *     pages — same masthead gradient, same 3-column lead grid, same
 *     Analyst Briefing card treatment, same Top Deals cards, same
 *     story rows, same sector-signals grid.
 *   - No interactive controls: Generate Memo / Add Thesis / Ask AI
 *     buttons, section rating thumbs, and ExportMenu are all dropped.
 *     The print PDF is a print artefact, not a live dashboard.
 *   - Evening Wrap gets the Morning Review reflection block (spec
 *     confirmation #4, Open Question 4 = include by default).
 *
 * Bug fixes vs the old react-pdf component (SPEC Section 2):
 *   - #1 header collision — resolved by rebuilding in HTML flexbox with
 *     explicit gaps instead of react-pdf row stack layout.
 *   - #2 UTC stamp — resolved via formatPTStamp (single source).
 *   - #3/4 mood bar + VIX + gradient masthead — reused from the live
 *     PrintMasthead component which renders the real CSS gradient.
 *   - #5 3-column lead card — rendered via CSS grid.
 *   - #6 missing stories / snapshot on Evening Wrap — rendered below.
 *   - #7/8 — Top Deals + typography inherits the web's Playfair/Inter
 *     via next/font CSS vars on the layout.
 */

import { stripHtml } from "@/lib/strip-html";
import { PrintMasthead } from "./print-masthead";
import {
  formatPTDateLong,
  formatPTStamp,
  formatPTTimeShort,
} from "@/lib/format-pt";

const HERITAGE_GOLD = "#d4a84b";
const DC_ESPRESSO = "#1a1208";
const DC_CREAM = "#fffdf9";

/* ── Types ─────────────────────────────────────────────────────────── */

export interface TopDeal {
  company: string;
  value?: string;
  deal_type?: string;
  one_liner?: string;
  sentiment?: string | null;
}

export interface PrintStory {
  id: string;
  title: string;
  source?: string;
  timestamp?: string;
  sector?: string;
  sentiment?: string;
  summary?: string;
  url?: string;
}

export interface SectorReflection {
  sector: string;
  verdict: "correct" | "wrong" | "partial";
  paragraph: string;
}
export interface TickerReflection {
  symbol: string;
  verdict: "correct" | "wrong" | "partial";
  paragraph: string;
}
export interface MorningReviewShape {
  aggregate_sentence?: string;
  sector_reflections?: SectorReflection[];
  ticker_reflection?: TickerReflection | null;
}

export interface PrintBriefingData {
  id: string;
  briefing_type: "morning" | "evening";
  headline?: string;
  summary?: string;
  lead_paragraph?: string;
  supporting_context?: string;
  what_to_watch?: string;
  market_tone?: string;
  sections?: Record<string, string> | null;
  sector_breakdown?: Record<string, string> | null;
  top_deals?: TopDeal[] | null;
  created_at?: string | null;
  market_pulse?: {
    sentiment_word?: string;
    narrative?: string;
    headlines?: Array<{ title: string; href?: string; tone?: string }>;
  } | null;
  morning_review?: MorningReviewShape | null;
}

export interface PrintBriefProps {
  briefing: PrintBriefingData;
  stories: PrintStory[];
  thesesCount: number | null;
  vix: { price: string; pct: number } | null;
}

/* ── Helpers ───────────────────────────────────────────────────────── */

type Tone = "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED" | "WATCH";

function normaliseTone(t?: string | null): Tone {
  if (!t) return "NEUTRAL";
  const l = t.toLowerCase();
  if (l.includes("bull") || l === "positive" || l.includes("risk-on")) return "BULLISH";
  if (l.includes("bear") || l === "negative" || l.includes("risk-off")) return "BEARISH";
  if (l.includes("mix")) return "MIXED";
  if (l.includes("watch")) return "WATCH";
  return "NEUTRAL";
}

function SentimentPill({ tone, size = "md" }: { tone: Tone; size?: "sm" | "md" }) {
  const style: Record<Tone, { bg: string; fg: string; bd: string }> = {
    BULLISH: { bg: "var(--pill-bull-bg)", fg: "var(--pill-bull-text)", bd: "var(--pill-bull-border)" },
    BEARISH: { bg: "var(--pill-bear-bg)", fg: "var(--pill-bear-text)", bd: "var(--pill-bear-border)" },
    NEUTRAL: { bg: "var(--pill-neutral-bg)", fg: "var(--pill-neutral-text)", bd: "var(--pill-neutral-border)" },
    MIXED:   { bg: "var(--pill-mixed-bg)",   fg: "var(--pill-mixed-text)",   bd: "var(--pill-mixed-border)" },
    WATCH:   { bg: "var(--pill-watch-bg)",   fg: "var(--pill-watch-text)",   bd: "var(--pill-watch-border)" },
  };
  const s = style[tone];
  const font = size === "sm" ? 9 : 10;
  const pad = size === "sm" ? "3px 7px" : "4px 9px";
  const tr = size === "sm" ? "0.10em" : "0.12em";
  return (
    <span
      style={{
        display: "inline-block",
        fontFamily: "var(--font-inter), Inter, sans-serif",
        fontSize: font,
        fontWeight: 700,
        letterSpacing: tr,
        padding: pad,
        borderRadius: 4,
        background: s.bg,
        color: s.fg,
        border: `1px solid ${s.bd}`,
      }}
    >
      {tone}
    </span>
  );
}

function splitIntoThree(raw: string): [string, string, string] {
  const text = stripHtml(raw).trim();
  if (!text) return ["", "", ""];
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length <= 1) return [text, "", ""];
  const third = Math.ceil(sentences.length / 3);
  return [
    sentences.slice(0, third).join(" "),
    sentences.slice(third, third * 2).join(" "),
    sentences.slice(third * 2).join(" "),
  ];
}

const SECTION_TITLES: Record<string, string> = {
  deals_and_ma: "Deals & M&A",
  public_markets: "Public Markets",
  macro_and_rates: "Macro & Rates",
  sector_spotlight: "Sector Spotlight",
  geopolitics: "Geopolitics",
  what_to_watch: "What to Watch",
  tomorrow_setup: "Tomorrow's Setup",
  closing_thoughts: "Closing Thoughts",
};

const MORNING_TAB_ORDER = [
  "deals_and_ma",
  "public_markets",
  "macro_and_rates",
  "sector_spotlight",
  "geopolitics",
];

const EVENING_TAB_ORDER = [
  "public_markets",
  "deals_and_ma",
  "sector_spotlight",
  "macro_and_rates",
  "geopolitics",
  "closing_thoughts",
];

/* ── Sub-sections ──────────────────────────────────────────────────── */

function MarketPulseHero({
  pulseWord,
  pulseBody,
  drivers,
  timeStr,
  kind,
}: {
  pulseWord: string;
  pulseBody: string;
  drivers: { label: string; tone: Tone }[];
  timeStr: string;
  kind: "morning" | "evening";
}) {
  return (
    <section className="print-section print-keep" style={{ marginBottom: 36 }}>
      <div
        style={{
          background: DC_ESPRESSO,
          borderRadius: 18,
          padding: "32px 36px",
          color: DC_CREAM,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            right: -60,
            top: -60,
            width: 260,
            height: 260,
            background: `radial-gradient(circle, ${HERITAGE_GOLD}60, transparent 70%)`,
            pointerEvents: "none",
          }}
        />
        <p
          className="font-sans"
          style={{
            fontSize: 10,
            letterSpacing: "0.20em",
            color: HERITAGE_GOLD,
            margin: "0 0 14px",
            fontWeight: 700,
            textTransform: "uppercase",
            position: "relative",
          }}
        >
          {kind === "evening" ? "Market Close" : "Market Pulse"} · {timeStr}
        </p>
        <h2
          className="font-[family-name:var(--font-playfair-display)]"
          style={{
            fontSize: "clamp(28px, 4vw, 40px)",
            fontWeight: 800,
            lineHeight: 1.05,
            letterSpacing: "-0.025em",
            margin: "0 0 20px",
            color: DC_CREAM,
            position: "relative",
          }}
        >
          {kind === "evening" ? "The session closed " : "Today the market is "}
          <span
            style={{
              background: HERITAGE_GOLD,
              color: DC_ESPRESSO,
              padding: "2px 14px",
              borderRadius: 8,
              display: "inline-block",
              transform: "rotate(-1deg)",
              boxShadow: "0 4px 0 rgba(0,0,0,0.15)",
            }}
          >
            {pulseWord}
          </span>
          .
        </h2>
        <p
          className="font-sans"
          style={{
            fontSize: 14,
            lineHeight: 1.6,
            color: "rgba(255,253,249,0.82)",
            margin: "0 0 20px",
            maxWidth: 620,
            whiteSpace: "pre-line",
            position: "relative",
          }}
        >
          {pulseBody}
        </p>
        {drivers.length > 0 && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", position: "relative" }}>
            {drivers.map((d, i) => (
              <div
                key={i}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 14px",
                  background: "rgba(255,253,249,0.08)",
                  border: "1px solid rgba(212,168,75,0.25)",
                  borderRadius: 24,
                }}
              >
                <span style={{ fontSize: 12, color: DC_CREAM, fontWeight: 500 }}>
                  {d.label}
                </span>
                <SentimentPill tone={d.tone} size="sm" />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function LeadSection({
  headline,
  leadCards,
  topDeals,
  tone,
}: {
  headline: string;
  leadCards: { n: string; label: string; body: string }[];
  topDeals: TopDeal[];
  tone: Tone;
}) {
  const gridCols =
    leadCards.length >= 3
      ? "repeat(3, minmax(0, 1fr))"
      : leadCards.length === 2
        ? "repeat(2, minmax(0, 1fr))"
        : "1fr";

  return (
    <section className="print-section" style={{ marginBottom: 40 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        <span
          className="font-sans"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: "#a88340",
            color: DC_ESPRESSO,
            padding: "5px 12px",
            borderRadius: 20,
            fontSize: 10,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            fontWeight: 800,
          }}
        >
          ★ Today&rsquo;s Lead
        </span>
        <SentimentPill tone={tone} />
        <span className="font-sans" style={{ fontSize: 11, color: "var(--text-secondary)" }}>
          Signalera Desk · 4 min
        </span>
      </div>

      <h2
        className="font-[family-name:var(--font-playfair-display)]"
        style={{
          fontSize: "clamp(26px, 3.2vw, 36px)",
          fontWeight: 800,
          lineHeight: 1.05,
          letterSpacing: "-0.025em",
          color: "var(--espresso)",
          margin: "0 0 24px",
        }}
      >
        {headline}
      </h2>

      {leadCards.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: gridCols,
            gap: 20,
          }}
        >
          {leadCards.map((p, i) => (
            <div
              key={i}
              className="print-card"
              style={{
                background: "var(--elevated)",
                border: "1px solid var(--border-base)",
                borderRadius: 14,
                padding: "22px 20px",
              }}
            >
              <div
                className="font-[family-name:var(--font-playfair-display)]"
                style={{
                  fontSize: 60,
                  fontWeight: 800,
                  color: HERITAGE_GOLD,
                  lineHeight: 0.85,
                  marginBottom: 8,
                  letterSpacing: "-0.03em",
                }}
              >
                {p.n}
              </div>
              <p
                className="font-sans"
                style={{
                  fontSize: 10,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  color: "var(--gold-dark)",
                  fontWeight: 700,
                  margin: "0 0 10px",
                }}
              >
                {p.label}
              </p>
              <p
                className="font-sans"
                style={{
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: "var(--text-primary)",
                  margin: 0,
                  whiteSpace: "pre-line",
                }}
              >
                {p.body}
              </p>
            </div>
          ))}
        </div>
      )}

      {topDeals.length > 0 && (
        <div
          style={{
            marginTop: 20,
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            padding: "16px 20px",
            borderRadius: 14,
            background: "var(--parchment-mid)",
            border: "1px dashed rgba(212,168,75,0.4)",
          }}
        >
          <span
            className="font-sans"
            style={{
              fontSize: 10,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "var(--gold-dark)",
              fontWeight: 800,
              alignSelf: "center",
            }}
          >
            ▶ Names to Watch
          </span>
          {topDeals.slice(0, 5).map((d, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "var(--elevated)",
                border: "1px solid var(--border-base)",
                borderRadius: 20,
                padding: "6px 12px",
              }}
            >
              <span
                className="font-data"
                style={{ fontSize: 12, fontWeight: 800, color: "var(--espresso)" }}
              >
                {d.company}
              </span>
              {d.deal_type && (
                <span className="font-sans" style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                  {d.deal_type}
                </span>
              )}
              <SentimentPill tone={normaliseTone(d.sentiment)} size="sm" />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TopDealsSection({ deals }: { deals: TopDeal[] }) {
  if (!deals || deals.length === 0) return null;
  const gridCols =
    deals.length >= 3
      ? "repeat(3, minmax(0, 1fr))"
      : deals.length === 2
        ? "repeat(2, minmax(0, 1fr))"
        : "1fr";
  return (
    <section className="print-section" style={{ marginBottom: 40 }}>
      <h3
        className="font-[family-name:var(--font-playfair-display)]"
        style={{
          fontSize: 24,
          fontWeight: 800,
          color: "var(--espresso)",
          margin: "0 0 18px",
          letterSpacing: "-0.015em",
        }}
      >
        Top Deals to Watch
      </h3>
      <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: 12 }}>
        {deals.map((deal, i) => (
          <div
            key={i}
            className="print-deal-row"
            style={{
              background: "var(--elevated)",
              border: "1px solid var(--border-base)",
              borderTop: `3px solid ${HERITAGE_GOLD}`,
              borderRadius: 12,
              padding: "16px 18px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <h4
                className="font-[family-name:var(--font-playfair-display)]"
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: "var(--espresso)",
                  margin: 0,
                  letterSpacing: "-0.01em",
                }}
              >
                {deal.company}
              </h4>
              <span
                className="font-data"
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--gold-dark)",
                  whiteSpace: "nowrap",
                }}
              >
                {deal.value || "Undisclosed"}
              </span>
            </div>
            {deal.deal_type && (
              <span
                className="font-data"
                style={{
                  display: "inline-block",
                  alignSelf: "flex-start",
                  fontSize: 9,
                  fontWeight: 800,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "var(--gold-dark)",
                  background: "var(--gold-muted)",
                  border: "1px solid var(--gold-border)",
                  padding: "3px 8px",
                  borderRadius: 4,
                }}
              >
                {deal.deal_type}
              </span>
            )}
            {deal.one_liner && (
              <p
                className="font-sans"
                style={{
                  fontSize: 12,
                  lineHeight: 1.55,
                  color: "var(--text-secondary)",
                  margin: 0,
                }}
              >
                {stripHtml(deal.one_liner)}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function AnalystBriefingSection({
  sections,
  order,
  headline,
}: {
  sections: Record<string, string>;
  order: string[];
  headline: string;
}) {
  const entries = order
    .map((key) => ({ key, title: SECTION_TITLES[key] || key, content: sections[key] }))
    .filter((s) => s.content && s.content.trim());

  if (entries.length === 0) return null;

  return (
    <section className="print-section" style={{ marginBottom: 40 }}>
      <h3
        className="font-[family-name:var(--font-playfair-display)]"
        style={{
          fontSize: 24,
          fontWeight: 800,
          color: "var(--espresso)",
          margin: "0 0 18px",
          letterSpacing: "-0.015em",
        }}
      >
        {headline}
      </h3>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 12,
        }}
      >
        {entries.map((s) => (
          <div
            key={s.key}
            className="print-card"
            style={{
              background: "var(--elevated)",
              border: "1px solid var(--border-base)",
              borderRadius: 14,
              borderLeft: `4px solid ${HERITAGE_GOLD}`,
              padding: "18px 20px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <h4
              className="font-[family-name:var(--font-playfair-display)]"
              style={{
                fontSize: 17,
                fontWeight: 700,
                color: "var(--espresso)",
                margin: 0,
                letterSpacing: "-0.01em",
              }}
            >
              {s.title}
            </h4>
            <p
              className="font-sans"
              style={{
                fontSize: 12.5,
                lineHeight: 1.6,
                color: "var(--text-primary)",
                margin: 0,
                whiteSpace: "pre-line",
              }}
            >
              {stripHtml(s.content)}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function SectorBreakdownSection({
  breakdown,
}: {
  breakdown: Record<string, string>;
}) {
  const keys = Object.keys(breakdown).filter((k) => breakdown[k] && breakdown[k].trim());
  if (keys.length === 0) return null;
  return (
    <section className="print-section" style={{ marginBottom: 40 }}>
      <h3
        className="font-[family-name:var(--font-playfair-display)]"
        style={{
          fontSize: 24,
          fontWeight: 800,
          color: "var(--espresso)",
          margin: "0 0 18px",
          letterSpacing: "-0.015em",
        }}
      >
        Sector Signals
      </h3>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 12,
        }}
      >
        {keys.map((sector) => (
          <div
            key={sector}
            className="print-card"
            style={{
              background: "var(--elevated)",
              border: "1px solid var(--border-base)",
              borderRadius: 12,
              padding: "14px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <p
              className="font-sans"
              style={{
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--gold-dark)",
                margin: 0,
              }}
            >
              {sector}
            </p>
            <p
              className="font-sans"
              style={{
                fontSize: 12,
                lineHeight: 1.55,
                color: "var(--text-primary)",
                margin: 0,
                whiteSpace: "pre-line",
              }}
            >
              {stripHtml(breakdown[sector])}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function MorningReviewSection({ review }: { review: MorningReviewShape }) {
  if (!review.aggregate_sentence) return null;

  const verdictPill = (verdict: SectorReflection["verdict"]) => {
    const styles: Record<string, { bg: string; fg: string; bd: string }> = {
      correct: { bg: "rgba(34,197,94,0.12)", fg: "var(--signal-up)", bd: "rgba(34,197,94,0.25)" },
      wrong: { bg: "rgba(239,68,68,0.12)", fg: "var(--signal-dn)", bd: "rgba(239,68,68,0.25)" },
      partial: { bg: "rgba(234,179,8,0.12)", fg: "var(--signal-warn)", bd: "rgba(234,179,8,0.25)" },
    };
    const s = styles[verdict];
    const labels: Record<string, string> = { correct: "Correct", wrong: "Wrong", partial: "Partial" };
    return (
      <span
        style={{
          display: "inline-block",
          fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          padding: "2px 7px",
          borderRadius: 4,
          background: s.bg,
          color: s.fg,
          border: `1px solid ${s.bd}`,
        }}
      >
        {labels[verdict]}
      </span>
    );
  };

  return (
    <section
      className="print-section print-card"
      style={{
        marginBottom: 36,
        padding: "20px 22px",
        borderRadius: 14,
        border: "1px solid var(--border-base)",
        background: "var(--elevated)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span
          className="font-data"
          style={{
            fontSize: 9,
            fontWeight: 800,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: HERITAGE_GOLD,
          }}
        >
          Morning Brief Review
        </span>
        <span style={{ flex: 1, height: 1, background: "rgba(212,168,75,0.18)" }} />
      </div>
      <p
        className="font-[family-name:var(--font-playfair-display)]"
        style={{
          fontSize: 18,
          lineHeight: 1.35,
          color: "var(--espresso)",
          margin: "0 0 16px",
        }}
      >
        {review.aggregate_sentence}
      </p>
      {(review.sector_reflections ?? []).length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
          {review.sector_reflections?.map((s) => (
            <div
              key={s.sector}
              style={{
                borderLeft: "3px solid rgba(212,168,75,0.45)",
                paddingLeft: 14,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span
                  className="font-sans"
                  style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}
                >
                  {s.sector}
                </span>
                {verdictPill(s.verdict)}
              </div>
              <p
                className="font-sans"
                style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--text-secondary)", margin: 0 }}
              >
                {s.paragraph}
              </p>
            </div>
          ))}
        </div>
      )}
      {review.ticker_reflection && (
        <div style={{ paddingTop: 14, borderTop: "1px solid var(--border-base)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span
              className="font-data"
              style={{ fontSize: 13, fontWeight: 700, color: HERITAGE_GOLD }}
            >
              {review.ticker_reflection.symbol}
            </span>
            {verdictPill(review.ticker_reflection.verdict)}
          </div>
          <p
            className="font-sans"
            style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--text-secondary)", margin: 0 }}
          >
            {review.ticker_reflection.paragraph}
          </p>
        </div>
      )}
    </section>
  );
}

function TopStoriesSection({ stories, label }: { stories: PrintStory[]; label: string }) {
  if (!stories || stories.length === 0) return null;
  return (
    <section className="print-section" style={{ marginBottom: 24 }}>
      <h3
        className="font-[family-name:var(--font-playfair-display)]"
        style={{
          fontSize: 24,
          fontWeight: 800,
          color: "var(--espresso)",
          margin: "0 0 18px",
          letterSpacing: "-0.015em",
        }}
      >
        {label}
      </h3>
      <ol
        style={{
          borderRadius: 12,
          border: "1px solid var(--border-base)",
          background: "var(--elevated)",
          overflow: "hidden",
          margin: 0,
          padding: 0,
          listStyle: "none",
        }}
      >
        {stories.map((s, i) => (
          <li
            key={s.id}
            className="print-story-row"
            style={{
              display: "grid",
              gridTemplateColumns: "32px 1fr auto",
              gap: 12,
              padding: "14px 14px",
              borderBottom:
                i === stories.length - 1 ? "none" : "1px solid var(--border-subtle)",
            }}
          >
            <span
              className="font-[family-name:var(--font-playfair-display)]"
              style={{
                fontSize: 20,
                fontWeight: 800,
                lineHeight: 1,
                paddingTop: 2,
                color: HERITAGE_GOLD,
              }}
            >
              {i + 1}
            </span>
            <div style={{ minWidth: 0 }}>
              <h4
                className="font-[family-name:var(--font-playfair-display)]"
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  lineHeight: 1.3,
                  color: "var(--espresso)",
                  margin: "0 0 6px",
                }}
              >
                {s.title}
              </h4>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 8,
                  marginBottom: 4,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    background:
                      s.sentiment === "bullish" || s.sentiment === "positive"
                        ? "var(--signal-up)"
                        : s.sentiment === "bearish" || s.sentiment === "negative"
                          ? "var(--signal-dn)"
                          : "var(--text-muted)",
                    display: "inline-block",
                  }}
                />
                {s.sector && (
                  <span
                    className="font-sans"
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: "2px 6px",
                      borderRadius: 3,
                      background: "var(--parchment-mid)",
                      color: "var(--text-secondary)",
                      border: "1px solid var(--border-base)",
                    }}
                  >
                    {s.sector}
                  </span>
                )}
                <span className="font-sans" style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {s.source} {s.timestamp ? `· ${s.timestamp}` : ""}
                </span>
              </div>
              {s.summary && (
                <p
                  className="font-sans"
                  style={{
                    fontSize: 12,
                    lineHeight: 1.55,
                    color: "var(--text-secondary)",
                    margin: 0,
                  }}
                >
                  {stripHtml(s.summary).slice(0, 200)}
                  {stripHtml(s.summary).length > 200 ? "…" : ""}
                </p>
              )}
            </div>
            <span />
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ── Main component ────────────────────────────────────────────────── */

export function PrintBrief({
  briefing,
  stories,
  thesesCount,
  vix,
}: PrintBriefProps) {
  const kind = briefing.briefing_type;
  const tone = normaliseTone(briefing.market_tone);
  const dateStr = formatPTDateLong(briefing.created_at ?? null);
  const timeStr = formatPTTimeShort(briefing.created_at ?? null);
  const moodWord =
    briefing.market_pulse?.sentiment_word || briefing.market_tone || "—";

  const pulseWord =
    briefing.market_pulse?.sentiment_word || briefing.market_tone || "mixed";
  const pulseBody =
    briefing.market_pulse?.narrative ||
    (briefing.summary ? stripHtml(briefing.summary) : "") ||
    (kind === "evening"
      ? "Today's session has closed. Detailed close commentary will appear here once the post-market synthesis lands."
      : "Pre-market synthesis is still stitching together.");

  const drivers: { label: string; tone: Tone }[] = (() => {
    const h = briefing.market_pulse?.headlines;
    if (Array.isArray(h) && h.length > 0) {
      return h.slice(0, 4).map((x) => ({
        label: x.title,
        tone: normaliseTone(x.tone ?? null),
      }));
    }
    if (briefing.top_deals && briefing.top_deals.length > 0) {
      return briefing.top_deals.slice(0, 3).map((d) => ({
        label: d.deal_type ? `${d.company} · ${d.deal_type}` : d.company,
        tone: "NEUTRAL" as Tone,
      }));
    }
    return [];
  })();

  const summaryThirds = splitIntoThree(briefing.summary || briefing.headline || "");
  const leadCards = ([
    {
      label: kind === "evening" ? "The Story" : "The Lead",
      body: briefing.lead_paragraph || summaryThirds[0],
    },
    { label: "The Context", body: briefing.supporting_context || summaryThirds[1] },
    { label: "What to Watch", body: briefing.what_to_watch || summaryThirds[2] },
  ] as { label: string; body: string }[])
    .filter((c) => c.body && c.body.trim() && c.body.trim() !== "—")
    .map((c, i) => ({ ...c, n: String(i + 1) }));

  const sections = briefing.sections || {};
  const sectorBreakdown = briefing.sector_breakdown || {};
  const tabOrder = kind === "evening" ? EVENING_TAB_ORDER : MORNING_TAB_ORDER;

  return (
    <>
      <PrintMasthead
        kind={kind}
        generatedAtIso={briefing.created_at}
        dateStr={dateStr}
        timeStr={timeStr}
        moodWord={moodWord}
        tone={tone}
        storyCount={stories.length}
        thesesCount={thesesCount}
        vix={vix}
      />

      <div style={{ padding: "28px 32px", maxWidth: 860 }}>
        <MarketPulseHero
          pulseWord={pulseWord}
          pulseBody={pulseBody}
          drivers={drivers}
          timeStr={timeStr}
          kind={kind}
        />

        {/* Date marker between Market Pulse and Today's Lead. Mirrors
            the "Morning Review" / "Evening Review" band on the live
            pages without the review reflection block (that lands below
            for Evening Wrap). */}
        <section style={{ marginBottom: 28 }}>
          <p
            className="font-sans"
            style={{
              fontSize: 10,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: "var(--gold-dark)",
              fontWeight: 800,
              margin: "0 0 10px",
            }}
          >
            {kind === "evening" ? "Evening Review" : "Morning Review"}
          </p>
          <h1
            className="font-[family-name:var(--font-playfair-display)]"
            style={{
              fontSize: "clamp(26px, 3.2vw, 36px)",
              fontWeight: 800,
              lineHeight: 1.05,
              color: "var(--espresso)",
              margin: "0 0 10px",
              letterSpacing: "-0.02em",
            }}
          >
            {dateStr}
          </h1>
          <p
            className="font-sans"
            style={{ fontSize: 12.5, color: "var(--text-secondary)", margin: 0 }}
          >
            {stories.length || "—"} stories worth your attention{" "}
            <span style={{ color: "var(--text-faint)" }}>·</span>{" "}
            <span className="font-data" style={{ fontSize: 12 }}>
              {formatPTStamp(briefing.created_at)}
            </span>
          </p>
        </section>

        <LeadSection
          headline={briefing.headline || "Morning Market Brief"}
          leadCards={leadCards}
          topDeals={briefing.top_deals ?? []}
          tone={tone}
        />

        {/* Evening Wrap: Morning Brief Review block (spec confirms
            include-by-default for parity with the live page). */}
        {kind === "evening" && briefing.morning_review && (
          <MorningReviewSection review={briefing.morning_review} />
        )}

        <TopDealsSection deals={briefing.top_deals ?? []} />

        <AnalystBriefingSection
          sections={sections}
          order={tabOrder}
          headline={kind === "evening" ? "Evening Analysis" : "Analyst Briefing"}
        />

        <SectorBreakdownSection breakdown={sectorBreakdown} />

        <TopStoriesSection
          stories={stories}
          label={kind === "evening" ? "Today's Top Stories" : "Today's Stories"}
        />
      </div>
    </>
  );
}

export default PrintBrief;

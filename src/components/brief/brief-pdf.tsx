/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Signalera Morning/Evening Brief — React PDF renderer.
 *
 * Uses built-in PDF fonts (Helvetica + Times-Roman) so no network font fetch is
 * required. Heritage Gold #c9922a for accents. Multi-page safe via `wrap` on
 * every major <View>.
 *
 * Consumed by `src/app/api/brief/export-pdf/route.ts`.
 */

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";

/* ── Types ─────────────────────────────────────────────────────────────── */

export interface TopDeal {
  company?: string;
  value?: string;
  deal_type?: string;
  one_liner?: string;
}

export interface MarketPulse {
  sentiment_word?: string;
  narrative?: string;
  headlines?: Array<{ title: string; href?: string }>;
}

export interface BriefPdfPayload {
  headline?: string;
  summary?: string;
  market_tone?: string;
  sections?: Record<string, string> | null;
  top_deals?: TopDeal[];
  sector_breakdown?: Record<string, string> | null;
  created_at?: string;
  market_pulse?: MarketPulse | null;
  briefing_type?: "morning" | "evening";
}

interface BriefPdfProps {
  briefing: BriefPdfPayload;
}

/* ── Tokens ────────────────────────────────────────────────────────────── */

const GOLD = "#c9922a";
const GOLD_MUTED = "#f5ecd8";
const INK = "#1f1a14";
const MUTED = "#6b6458";
const FAINT = "#a79d8b";
const RULE = "#e7dec8";

/* ── Section title map — mirrors morning-brief/page.tsx ────────────────── */

const SECTION_TITLES: Record<string, string> = {
  macro_and_rates: "Macro & Rates",
  deals_and_ma: "Deals & M&A",
  public_markets: "Public Markets",
  geopolitics: "Geopolitics",
  sector_spotlight: "Sector Spotlight",
  what_to_watch: "What to Watch",
  tomorrow_setup: "Tomorrow's Setup",
  // Personalized role-specific keys
  what_happened: "What Happened",
  why_it_matters: "Why It Matters",
  day_recap: "Day Recap",
  mechanism: "Mechanism",
  tomorrow_watch: "Tomorrow's Watch",
  sector_signals: "Sector Signals",
  key_events: "Key Events",
  actionable_signals: "Actionable Signals",
  catalysts: "Catalysts",
  entry_triggers: "Entry Triggers",
  thesis_updates: "Thesis Updates",
  new_signals: "New Signals",
  tomorrow_events: "Tomorrow's Events",
  market_summary: "Market Summary",
  top_stories: "Top Stories",
  key_events_today: "Key Events Today",
  ratings_changes: "Ratings Changes",
  catalyst_calendar: "Catalyst Calendar",
  overnight_ma: "Overnight M&A",
  macro_deal_pricing: "Macro & Deal Pricing",
  regulatory_news: "Regulatory News",
  deals_announced: "Deals Announced",
  credit_markets: "Credit Markets",
  sector_valuations: "Sector Valuations",
  market_moves: "Market Moves",
  risk_framing: "Risk Framing",
  client_talking_points: "Client Talking Points",
  portfolio_moves: "Portfolio Moves",
  client_questions: "Client Questions",
  overnight_risks: "Overnight Risks",
  winners_losers: "Winners & Losers",
  positioning: "Positioning",
};

function titleForKey(k: string): string {
  return (
    SECTION_TITLES[k] ??
    k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

function formatGeneratedAt(iso?: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return (
      d.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      }) +
      " · " +
      d.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    );
  } catch {
    return iso;
  }
}

/* ── Styles ────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingBottom: 56,
    paddingHorizontal: 48,
    fontFamily: "Helvetica",
    fontSize: 10.5,
    color: INK,
    lineHeight: 1.5,
  },
  /* Header */
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 6,
  },
  wordmark: {
    fontFamily: "Times-Bold",
    fontSize: 22,
    color: GOLD,
    letterSpacing: 0.3,
  },
  headerMetaLeft: {
    fontFamily: "Helvetica",
    fontSize: 8.5,
    letterSpacing: 2,
    color: MUTED,
    textTransform: "uppercase",
    marginTop: 2,
  },
  headerMetaRight: {
    fontFamily: "Helvetica",
    fontSize: 9,
    color: MUTED,
    textAlign: "right",
  },
  goldRule: {
    borderBottomWidth: 1.2,
    borderBottomColor: GOLD,
    marginTop: 6,
    marginBottom: 14,
  },
  /* Labels & headings */
  sectionLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8.5,
    letterSpacing: 2,
    color: GOLD,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  displayHeadline: {
    fontFamily: "Times-Bold",
    fontSize: 20,
    lineHeight: 1.25,
    color: INK,
    marginBottom: 8,
  },
  sectionHeading: {
    fontFamily: "Times-Bold",
    fontSize: 14,
    color: INK,
    marginBottom: 4,
  },
  /* Body */
  body: {
    fontFamily: "Helvetica",
    fontSize: 10.5,
    color: INK,
    lineHeight: 1.55,
  },
  bodyMuted: {
    fontFamily: "Helvetica",
    fontSize: 10,
    color: MUTED,
    lineHeight: 1.5,
  },
  /* Pull quote */
  pullQuote: {
    fontFamily: "Times-Italic",
    fontSize: 13,
    lineHeight: 1.45,
    color: INK,
    borderLeftWidth: 2,
    borderLeftColor: GOLD,
    paddingLeft: 10,
    marginBottom: 10,
  },
  /* Deals */
  dealRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: RULE,
  },
  dealCompany: {
    fontFamily: "Times-Bold",
    fontSize: 11,
    color: INK,
    flex: 1.4,
  },
  dealType: {
    fontFamily: "Helvetica",
    fontSize: 9,
    color: MUTED,
    flex: 0.8,
  },
  dealValue: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10.5,
    color: GOLD,
    flex: 0.8,
    textAlign: "right",
  },
  dealOneLiner: {
    fontFamily: "Helvetica",
    fontSize: 9.5,
    color: MUTED,
    marginTop: 2,
  },
  /* Misc */
  block: {
    marginBottom: 16,
  },
  para: {
    marginBottom: 6,
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 48,
    right: 48,
    fontFamily: "Helvetica",
    fontSize: 8,
    color: FAINT,
    textAlign: "center",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  sectorPill: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: GOLD,
    backgroundColor: GOLD_MUTED,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 3,
    marginRight: 6,
  },
});

/* ── Helpers ───────────────────────────────────────────────────────────── */

function splitParagraphs(text?: string): string[] {
  if (!text) return [];
  return text
    .split(/\n\s*\n|\r\n\r\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/* ── Subcomponents ─────────────────────────────────────────────────────── */

function Paragraphs({ text, style }: { text?: string; style?: any }) {
  const paras = splitParagraphs(text);
  if (paras.length === 0) return null;
  return (
    <>
      {paras.map((p, i) => (
        <Text key={i} style={[styles.body, styles.para, style].filter(Boolean) as any}>
          {p}
        </Text>
      ))}
    </>
  );
}

/* ── Main Document ─────────────────────────────────────────────────────── */

export function BriefPdf({ briefing }: BriefPdfProps) {
  const label =
    (briefing.briefing_type ?? "morning") === "evening"
      ? "EVENING WRAP"
      : "MORNING BRIEF";
  const generatedAt = formatGeneratedAt(briefing.created_at);
  const pulse = briefing.market_pulse ?? null;
  const sections = briefing.sections ?? {};
  const sectionEntries = Object.entries(sections).filter(
    ([, v]) => typeof v === "string" && v.trim().length > 0,
  );
  const topDeals = (briefing.top_deals ?? []).filter((d) => d && (d.company || d.value || d.one_liner));

  return (
    <Document
      title={`Signalera ${label.toLowerCase()}`}
      author="Signalera"
      creator="Signalera"
    >
      <Page size="LETTER" style={styles.page} wrap>
        {/* Header */}
        <View style={styles.headerRow} fixed>
          <View>
            <Text style={styles.wordmark}>Signalera</Text>
            <Text style={styles.headerMetaLeft}>{label}</Text>
          </View>
          <View>
            <Text style={styles.headerMetaRight}>
              {generatedAt || "Generated just now"}
            </Text>
            {briefing.market_tone ? (
              <Text style={styles.headerMetaRight}>
                Tone: {briefing.market_tone}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.goldRule} fixed />

        {/* Market Pulse */}
        {pulse && (pulse.sentiment_word || pulse.narrative) ? (
          <View style={styles.block} wrap>
            <Text style={styles.sectionLabel}>Market Pulse</Text>
            {pulse.sentiment_word ? (
              <Text style={styles.pullQuote}>
                &ldquo;Today the market is {pulse.sentiment_word}.&rdquo;
              </Text>
            ) : null}
            <Paragraphs text={pulse.narrative} />
            {pulse.headlines && pulse.headlines.length > 0 ? (
              <View style={{ marginTop: 6 }}>
                <Text style={styles.bodyMuted}>
                  Headlines driving this:
                </Text>
                {pulse.headlines.slice(0, 4).map((h, i) => (
                  <Text key={i} style={styles.bodyMuted}>
                    {"  • "}
                    {h.title}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Today's Lead */}
        {(briefing.headline || briefing.summary) && (
          <View style={styles.block} wrap>
            <Text style={styles.sectionLabel}>Today&rsquo;s Lead</Text>
            {briefing.headline ? (
              <Text style={styles.displayHeadline}>{briefing.headline}</Text>
            ) : null}
            <Paragraphs text={briefing.summary} />
          </View>
        )}

        {/* Analyst Briefing — expanded sections */}
        {sectionEntries.length > 0 && (
          <View style={styles.block} wrap>
            <Text style={styles.sectionLabel}>Analyst Briefing</Text>
            {sectionEntries.map(([key, body]) => (
              <View key={key} style={{ marginBottom: 12 }} wrap>
                <Text style={styles.sectionHeading}>{titleForKey(key)}</Text>
                <Paragraphs text={body as string} />
              </View>
            ))}
          </View>
        )}

        {/* Top Deals */}
        {topDeals.length > 0 && (
          <View style={styles.block} wrap>
            <Text style={styles.sectionLabel}>Top Deals to Watch</Text>
            {topDeals.map((deal, i) => (
              <View key={i} style={{ marginBottom: 8 }} wrap={false}>
                <View style={styles.dealRow}>
                  <Text style={styles.dealCompany}>
                    {deal.company || "—"}
                  </Text>
                  <Text style={styles.dealType}>
                    {deal.deal_type || ""}
                  </Text>
                  <Text style={styles.dealValue}>{deal.value || ""}</Text>
                </View>
                {deal.one_liner ? (
                  <Text style={styles.dealOneLiner}>{deal.one_liner}</Text>
                ) : null}
              </View>
            ))}
          </View>
        )}

        {/* Sector Breakdown (bonus, shown if present) */}
        {briefing.sector_breakdown &&
          Object.keys(briefing.sector_breakdown).length > 0 && (
            <View style={styles.block} wrap>
              <Text style={styles.sectionLabel}>Sector Breakdown</Text>
              {Object.entries(briefing.sector_breakdown)
                .filter(([, v]) => typeof v === "string" && (v as string).trim().length > 0)
                .map(([sector, body]) => (
                  <View key={sector} style={{ marginBottom: 10 }} wrap={false}>
                    <Text style={styles.sectionHeading}>{sector}</Text>
                    <Text style={styles.body}>{body as string}</Text>
                  </View>
                ))}
            </View>
          )}

        {/* Footer */}
        <Text
          style={styles.footer}
          fixed
          render={({ pageNumber, totalPages }) =>
            `Signalera · ${label} · ${pageNumber} / ${totalPages}`
          }
        />
      </Page>
    </Document>
  );
}

export default BriefPdf;

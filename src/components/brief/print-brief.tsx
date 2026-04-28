/**
 * PrintBrief — newsletter-style PDF document renderer.
 *
 * Server component (no "use client", no hooks). Rendered by
 * /print/[briefing_id]/page.tsx, which Puppeteer navigates to from
 * /api/brief/export-pdf.
 *
 * ──────────────────────────────────────────────────────────────────
 * Design intent
 * ──────────────────────────────────────────────────────────────────
 * This is a NEWSLETTER DOCUMENT, not a dashboard mirror. The previous
 * implementation aimed for "1:1 visual fidelity" with the live web
 * pages and produced PDFs that read as "AI dashboard repurposed for
 * print." This rewrite is a deliberate rebuild against a finance-
 * newsletter aesthetic — Stratechery email-as-PDF, Matt Levine's
 * Money Stuff, FT Alphaville. NOT marketing pages, NOT dashboards.
 *
 * Locked decisions (Q1–Q10, do not redesign):
 *   Q1  Cover identity: simple SIGNALERA wordmark masthead, no gold
 *       gradient, no marketing tagline. Heritage Gold (#c9922a) thin
 *       horizontal rule below masthead. Edition label top-right.
 *   Q2  Section order: Masthead → Pulse → Today's Lead → Top Deals →
 *       Analyst/Evening Briefing → Sector Signals → For Your Watchlist
 *       (conditional) → Disclaimer. Today's Stories is CUT from the
 *       PDF entirely.
 *   Q3  Top Deals dedup: omit any top_deal whose company matches the
 *       Today's Lead deal (case-insensitive, whitespace-trimmed).
 *       Never render "See lead." as a card body.
 *   Q4  deal_type hallucination fix: server-side step in the print
 *       page route replaces synthesize-generated deal_type with
 *       deal_flow.deal_type when company matches. If no match and
 *       value not in the allowlist (M&A, VC Round, IPO, Funding, PE
 *       Investment, Debt Financing, Acquisition, Series A–F, LBO,
 *       Asset Sale, Minority Stake, Recap, Restructuring, SPAC),
 *       omit the type pill silently.
 *   Q5  "Evening Analysis" → "Evening Briefing" (parallel to Morning
 *       Briefing / Analyst Briefing). All other names unchanged.
 *   Q6  AI disclaimer: small gray footer on EVERY page —
 *       "AI-generated. Not investment advice. Verify before acting."
 *       Last page also carries the full disclaimer paragraph.
 *   Q7  Edition framing: "Morning Brief · Monday, April 27, 2026"
 *       or "Evening Wrap · Friday, April 24, 2026". Date and brief
 *       type only. Top-right of masthead.
 *   Q8  Color/typography: Heritage Gold #c9922a sparingly (rule,
 *       accent dot, deal values, section dividers). Pure white
 *       (#ffffff) background — no cream tints, no espresso, no dark
 *       mode. Body type serif ~10.5pt. Display serif. No rounded
 *       corners, no drop shadows. Hairline gray (#e5e5e5) or gold
 *       dividers only.
 *   Q9  Three files in scope: this file, print-masthead.tsx,
 *       export-pdf/route.ts. Web brief pages stay unchanged.
 *   Q10 Email is out of scope — separate PR.
 *
 * ──────────────────────────────────────────────────────────────────
 * Briefing prop inventory (what this component reads)
 * ──────────────────────────────────────────────────────────────────
 *   briefing.id                            — UUID, used as DOM data attr
 *   briefing.briefing_type                 — "morning" | "evening"
 *   briefing.headline                      — string, page-1 lead headline
 *   briefing.summary                       — string, fallback for pulse/lead
 *   briefing.lead_paragraph                — string, "The Story" / "The Lead"
 *   briefing.supporting_context            — string, "The Context"
 *   briefing.what_to_watch                 — string, "What to Watch"
 *   briefing.market_tone                   — string, drives sentiment tag
 *   briefing.sections                      — Record<string,string>, keyed by:
 *                                            deals_and_ma, public_markets,
 *                                            macro_and_rates, sector_spotlight,
 *                                            geopolitics, what_to_watch,
 *                                            tomorrow_setup, closing_thoughts
 *   briefing.sector_breakdown              — Record<string,string> per sector
 *   briefing.top_deals[i].company          — string
 *   briefing.top_deals[i].value            — "$3.25B" / "Undisclosed"
 *   briefing.top_deals[i].deal_type        — string (validated against allowlist)
 *   briefing.top_deals[i].one_liner        — short prose
 *   briefing.top_deals[i].sentiment        — string|null
 *   briefing.created_at                    — ISO timestamp, drives date/time
 *   briefing.market_pulse.sentiment_word   — "mixed" / "bullish" etc
 *   briefing.market_pulse.narrative        — pulse prose
 *   briefing.market_pulse.headlines[i].title — "STORIES IN BRIEF" rows
 *   briefing.market_pulse.headlines[i].tone — sentiment for that row
 *   briefing.morning_review.aggregate_sentence — evening-only review block
 *   briefing.morning_review.sector_reflections[i] — {sector, verdict, paragraph}
 *   briefing.morning_review.ticker_reflection     — {symbol, verdict, paragraph}
 *
 * Other props:
 *   stories[]      — Today's Stories list — CUT from the PDF (Q2). Kept
 *                    in the type signature so the route doesn't break.
 *   thesesCount    — number|null, not rendered in newsletter view
 *   vix            — VIX snapshot, not rendered (was masthead stat)
 *   formatLabel    — string|null, fallback for missing headline
 *   userAddendum   — string|null, V4B per-user addendum. When present,
 *                    drives the "For Your Watchlist" section. (Per Q2:
 *                    watchlist baking already lives inside briefing
 *                    section text; the V4B addendum is the personalized
 *                    addendum block we surface explicitly.)
 */

import { stripHtml } from "@/lib/strip-html";
import { PrintMasthead } from "./print-masthead";
import { formatPTDateLong } from "@/lib/format-pt";

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
  formatLabel?: string | null;
  userAddendum?: string | null;
}

/* ── Stub component (commit 1) ─────────────────────────────────────── */
/* Subsequent commits flesh out the newsletter sections. The
   data-print-brief-root marker is kept so the export-pdf validator
   doesn't false-positive while the rebuild is in progress. */

/* ── Layout primitives ─────────────────────────────────────────────── */

const HERITAGE_GOLD = "#c9922a";
const HAIRLINE_GRAY = "#e5e5e5";

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

/** Small-caps section divider, sans-serif, gold accent dot.
 *  Used between major sections per Q8 ("small caps section dividers"). */
function SectionDivider({ label }: { label: string }) {
  return (
    <div className="mt-10 mb-4 flex items-center gap-3 break-inside-avoid">
      <span
        aria-hidden
        style={{
          width: 4,
          height: 4,
          background: HERITAGE_GOLD,
          display: "inline-block",
        }}
      />
      <span
        className="font-sans uppercase text-neutral-700"
        style={{
          fontFamily: "Helvetica, Arial, sans-serif",
          fontSize: 9.5,
          letterSpacing: "0.22em",
          fontWeight: 600,
        }}
      >
        {label}
      </span>
      <span
        aria-hidden
        className="flex-1"
        style={{ height: 1, background: HAIRLINE_GRAY }}
      />
    </div>
  );
}

/** Stub used in commit 3 — replaced section-by-section in commits 4–9. */
function SectionStub({ name }: { name: string }) {
  return (
    <div className="my-2 text-[10px] uppercase tracking-widest text-neutral-400">
      [todo: {name}]
    </div>
  );
}

/* ── Helpers ──────────────────────────────────────────────────────── */

/** A top_deal with one_liner === "See lead." (or "see lead", case- /
 *  punctuation-insensitive) is the company already covered by Today's
 *  Lead. Used for Q3 dedup ("never render 'See lead.' as a card body")
 *  and for Names-to-Watch list trimming. */
function isSeeLeadOneLiner(s?: string | null): boolean {
  if (!s) return false;
  return s.trim().toLowerCase().replace(/[.!?]+$/, "") === "see lead";
}

function leadDealCompany(deals: TopDeal[] | null | undefined): string | null {
  if (!Array.isArray(deals)) return null;
  const m = deals.find((d) => isSeeLeadOneLiner(d.one_liner));
  if (m && m.company) return m.company.trim();
  return null;
}

function normaliseCompany(s?: string | null): string {
  return (s || "").trim().toLowerCase();
}

/** Q4 — display allowlist for the deal_type pill. Anything else
 *  (including the synthesize hallucination "Strategic Investment") is
 *  silently omitted. The print page route also runs a deal_flow lookup
 *  and overrides deal_type with the structured value when company
 *  matches; the allowlist is the second line of defense. */
const DEAL_TYPE_ALLOWLIST: ReadonlySet<string> = new Set([
  "M&A",
  "VC Round",
  "IPO",
  "Funding",
  "PE Investment",
  "Debt Financing",
  "Acquisition",
  "Series A",
  "Series B",
  "Series C",
  "Series D",
  "Series E",
  "Series F",
  "LBO",
  "Asset Sale",
  "Minority Stake",
  "Recap",
  "Restructuring",
  "SPAC",
]);

function isAllowedDealType(t?: string | null): boolean {
  if (!t) return false;
  return DEAL_TYPE_ALLOWLIST.has(t.trim());
}

/* ── Section: Market Pulse hero (C4) ──────────────────────────────── */

function MarketPulseSection({
  kind,
  moodWord,
  narrative,
  headlines,
}: {
  kind: "morning" | "evening";
  moodWord: string;
  narrative: string;
  headlines: Array<{ title: string; tone?: string }>;
}) {
  const heroPrefix =
    kind === "evening" ? "The session closed" : "Today the market is";
  const cleanWord = (moodWord || "mixed").toString().trim().toLowerCase();

  return (
    <section
      aria-label="Market Pulse"
      className="break-inside-avoid"
      data-section="pulse"
    >
      <p
        className="font-sans uppercase text-neutral-500"
        style={{
          fontFamily: "Helvetica, Arial, sans-serif",
          fontSize: 9,
          letterSpacing: "0.22em",
          fontWeight: 600,
          marginBottom: 12,
        }}
      >
        Market Pulse
      </p>
      <h2
        className="font-serif italic text-black"
        style={{
          fontFamily: "'Times New Roman', Times, serif",
          fontSize: 28,
          lineHeight: 1.18,
          letterSpacing: "-0.005em",
          fontWeight: 500,
          margin: 0,
        }}
      >
        {heroPrefix} {cleanWord}.
      </h2>
      {narrative ? (
        <p
          className="text-neutral-800"
          style={{
            fontFamily: "'Times New Roman', Times, serif",
            fontSize: 11,
            lineHeight: 1.65,
            marginTop: 16,
            maxWidth: 560,
            whiteSpace: "pre-line",
          }}
        >
          {narrative}
        </p>
      ) : null}
      {headlines.length > 0 ? (
        <>
          <SectionDivider label="Stories in Brief" />
          <ul className="m-0 p-0 list-none">
            {headlines.slice(0, 5).map((h, i) => {
              const tone = normaliseTone(h.tone);
              return (
                <li
                  key={`${i}-${h.title}`}
                  className="flex items-baseline justify-between gap-6 py-2"
                  style={{ borderBottom: `1px solid ${HAIRLINE_GRAY}` }}
                >
                  <span
                    className="text-black"
                    style={{
                      fontFamily: "'Times New Roman', Times, serif",
                      fontSize: 11,
                      lineHeight: 1.45,
                    }}
                  >
                    {stripHtml(h.title)}
                  </span>
                  <span
                    className="font-sans uppercase shrink-0 text-neutral-500"
                    style={{
                      fontFamily: "Helvetica, Arial, sans-serif",
                      fontSize: 8.5,
                      letterSpacing: "0.18em",
                      fontWeight: 700,
                    }}
                  >
                    {tone}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </section>
  );
}

/* ── Section: Top Deals to Watch (C6) ─────────────────────────────── */

function TopDealsSection({ deals }: { deals: TopDeal[] }) {
  if (deals.length === 0) return null;

  return (
    <section data-section="top-deals">
      <div
        className="grid grid-cols-2 gap-x-8 gap-y-6"
        style={{
          borderTop: `1px solid ${HAIRLINE_GRAY}`,
          paddingTop: 18,
        }}
      >
        {deals.map((d, i) => (
          <div
            key={`${i}-${d.company}`}
            className="break-inside-avoid"
            style={{
              // Right column gets a left hairline rule. Bottom rule on
              // first row when 4+ deals would force a wrap.
              borderLeft:
                i % 2 === 1 ? `1px solid ${HAIRLINE_GRAY}` : undefined,
              paddingLeft: i % 2 === 1 ? 24 : 0,
            }}
          >
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <h4
                className="font-serif font-bold text-black"
                style={{
                  fontFamily: "'Times New Roman', Times, serif",
                  fontSize: 13,
                  lineHeight: 1.25,
                  margin: 0,
                  letterSpacing: "-0.005em",
                }}
              >
                {d.company}
              </h4>
              <span
                className="font-sans shrink-0"
                style={{
                  fontFamily: "Helvetica, Arial, sans-serif",
                  fontSize: 11,
                  fontWeight: 700,
                  color: HERITAGE_GOLD,
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                }}
              >
                {d.value || "Undisclosed"}
              </span>
            </div>
            {isAllowedDealType(d.deal_type) ? (
              <p
                className="font-sans uppercase text-neutral-600"
                style={{
                  fontFamily: "Helvetica, Arial, sans-serif",
                  fontSize: 8.5,
                  letterSpacing: "0.18em",
                  fontWeight: 700,
                  margin: "0 0 6px",
                }}
              >
                {d.deal_type}
              </p>
            ) : null}
            {d.one_liner ? (
              <p
                className="text-neutral-800"
                style={{
                  fontFamily: "'Times New Roman', Times, serif",
                  fontSize: 10.5,
                  lineHeight: 1.55,
                  margin: 0,
                }}
              >
                {stripHtml(d.one_liner)}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── Section: Today's Lead (C5) ────────────────────────────────────── */

function TodaysLeadSection({
  headline,
  leadParagraph,
  supportingContext,
  whatToWatch,
  namesToWatch,
}: {
  headline: string;
  leadParagraph: string;
  supportingContext: string;
  whatToWatch: string;
  namesToWatch: TopDeal[];
}) {
  return (
    <section data-section="lead">
      <h3
        className="font-serif font-bold text-black"
        style={{
          fontFamily: "'Times New Roman', Times, serif",
          fontSize: 22,
          lineHeight: 1.18,
          letterSpacing: "-0.005em",
          margin: "0 0 12px",
        }}
      >
        {headline}
      </h3>

      {leadParagraph ? (
        <p
          className="text-neutral-900"
          style={{
            fontFamily: "'Times New Roman', Times, serif",
            fontSize: 11,
            lineHeight: 1.65,
            margin: "0 0 12px",
            whiteSpace: "pre-line",
          }}
        >
          {leadParagraph}
        </p>
      ) : null}

      {supportingContext ? (
        <p
          className="text-neutral-900"
          style={{
            fontFamily: "'Times New Roman', Times, serif",
            fontSize: 11,
            lineHeight: 1.65,
            margin: "0 0 12px",
            whiteSpace: "pre-line",
          }}
        >
          {supportingContext}
        </p>
      ) : null}

      {whatToWatch ? (
        <div
          className="break-inside-avoid"
          style={{ marginTop: 14, marginBottom: 4 }}
        >
          <p
            className="font-sans uppercase text-neutral-700"
            style={{
              fontFamily: "Helvetica, Arial, sans-serif",
              fontSize: 9,
              letterSpacing: "0.18em",
              fontWeight: 700,
              margin: "0 0 6px",
            }}
          >
            What to Watch
          </p>
          <p
            className="text-neutral-900"
            style={{
              fontFamily: "'Times New Roman', Times, serif",
              fontSize: 11,
              lineHeight: 1.65,
              margin: 0,
              whiteSpace: "pre-line",
            }}
          >
            {whatToWatch}
          </p>
        </div>
      ) : null}

      {namesToWatch.length > 0 ? (
        <div className="break-inside-avoid" style={{ marginTop: 16 }}>
          <p
            className="font-sans uppercase text-neutral-700"
            style={{
              fontFamily: "Helvetica, Arial, sans-serif",
              fontSize: 9,
              letterSpacing: "0.18em",
              fontWeight: 700,
              margin: "0 0 6px",
            }}
          >
            Names to Watch
          </p>
          <p
            className="text-neutral-800"
            style={{
              fontFamily: "'Times New Roman', Times, serif",
              fontSize: 11,
              lineHeight: 1.6,
              margin: 0,
            }}
          >
            {namesToWatch.map((d, i) => {
              const tone = normaliseTone(d.sentiment);
              return (
                <span key={`${i}-${d.company}`}>
                  <span className="text-black">{d.company}</span>
                  <span
                    className="font-sans uppercase text-neutral-500"
                    style={{
                      fontFamily: "Helvetica, Arial, sans-serif",
                      fontSize: 8,
                      letterSpacing: "0.16em",
                      fontWeight: 700,
                      marginLeft: 6,
                    }}
                  >
                    {tone}
                  </span>
                  {i < namesToWatch.length - 1 ? (
                    <span className="text-neutral-400">{"  ·  "}</span>
                  ) : null}
                </span>
              );
            })}
          </p>
        </div>
      ) : null}
    </section>
  );
}

/* ── Main component ────────────────────────────────────────────────── */

export function PrintBrief({
  briefing,
  stories: _stories,
  thesesCount: _thesesCount,
  vix: _vix,
  formatLabel,
  userAddendum,
}: PrintBriefProps) {
  const dateStr = formatPTDateLong(briefing.created_at ?? null);
  const kind = briefing.briefing_type;
  const headline =
    (briefing.headline && stripHtml(briefing.headline).trim()) ||
    formatLabel ||
    (kind === "evening" ? "Evening Wrap" : "Morning Market Brief");

  // Pulse hero data prep
  const moodWord =
    briefing.market_pulse?.sentiment_word ||
    briefing.market_tone ||
    "mixed";
  const narrative =
    (briefing.market_pulse?.narrative &&
      stripHtml(briefing.market_pulse.narrative).trim()) ||
    (briefing.summary && stripHtml(briefing.summary).trim()) ||
    "";
  const pulseHeadlines = (briefing.market_pulse?.headlines ?? []).filter(
    (h) => h && typeof h.title === "string" && h.title.trim(),
  );

  // Today's Lead data prep
  const leadParagraph =
    (briefing.lead_paragraph && stripHtml(briefing.lead_paragraph).trim()) ||
    "";
  const supportingContext =
    (briefing.supporting_context &&
      stripHtml(briefing.supporting_context).trim()) ||
    "";
  const whatToWatch =
    (briefing.what_to_watch && stripHtml(briefing.what_to_watch).trim()) || "";
  const allDeals = briefing.top_deals ?? [];
  const leadCompany = leadDealCompany(allDeals); // for Q3 dedup
  const namesToWatch = allDeals
    // skip the "See lead." entry from Names to Watch — Today's Lead
    // already covers that company in its prose.
    .filter((d) => !isSeeLeadOneLiner(d.one_liner))
    .slice(0, 5);

  // Q3 — Top Deals dedup. Drop:
  //   1. any deal whose one_liner === "See lead." (we never render that
  //      string as a card body — it's a sentinel, not content)
  //   2. any deal whose company name matches the Today's Lead deal
  //      (the lead already covers it; rendering twice reads as filler)
  const topDealsForCards = allDeals.filter((d) => {
    if (isSeeLeadOneLiner(d.one_liner)) return false;
    if (
      leadCompany &&
      normaliseCompany(d.company) === normaliseCompany(leadCompany)
    ) {
      return false;
    }
    return true;
  });

  // Q2 / Q9: stories[] (Today's Stories) is intentionally not rendered —
  // it reads as raw aggregation in the PDF. thesesCount and vix were
  // masthead stats in the old design; the new newsletter masthead omits
  // them. Prefixed with _ above to signal intentional non-render.

  return (
    <div
      data-print-brief-root
      data-briefing-id={briefing.id}
      data-briefing-type={kind}
      className="bg-white text-black"
      style={{
        fontFamily: "'Times New Roman', Times, serif",
        fontSize: 10.5,
        lineHeight: 1.55,
      }}
    >
      <PrintMasthead kind={kind} dateStr={dateStr} />

      <main className="px-10 pt-6 pb-12">
        {/* Section 1 — Market Pulse hero (page 1). */}
        <MarketPulseSection
          kind={kind}
          moodWord={moodWord}
          narrative={narrative}
          headlines={pulseHeadlines}
        />

        {/* Section 2 — Today's Lead (page 1–2). */}
        <SectionDivider label="Today's Lead" />
        <TodaysLeadSection
          headline={headline}
          leadParagraph={leadParagraph}
          supportingContext={supportingContext}
          whatToWatch={whatToWatch}
          namesToWatch={namesToWatch}
        />

        {/* Section 3 — Top Deals (page 2–3). Q3 dedup applied. If 0
            deals remain after dedup, the entire section is dropped
            (TopDealsSection returns null). */}
        {topDealsForCards.length > 0 ? (
          <>
            <SectionDivider label="Top Deals to Watch" />
            <TopDealsSection deals={topDealsForCards} />
          </>
        ) : null}

        {/* Section 4 — Analyst / Evening Briefing (page 3–4). Q5: rename
            Evening Analysis → Evening Briefing. Implemented in C7. */}
        <SectionDivider
          label={kind === "evening" ? "Evening Briefing" : "Analyst Briefing"}
        />
        <section data-section="briefing">
          <SectionStub name="analyst / evening briefing (C7)" />
        </section>

        {/* Section 5 — Sector Signals (page 4). Forced new page per spec.
            Implemented in C8. */}
        <section
          data-section="sector"
          className="break-before-page"
        >
          <SectionDivider label="Sector Signals" />
          <SectionStub name="sector signals (C8)" />
        </section>

        {/* Section 6 — For Your Watchlist. Conditional: only rendered
            when userAddendum is present. Implemented in C9. */}
        {userAddendum ? (
          <section data-section="watchlist" className="break-inside-avoid">
            <SectionDivider label="For Your Watchlist" />
            <SectionStub name="for your watchlist (C9)" />
          </section>
        ) : null}

        {/* Section 7 — Disclaimer (last page). Implemented in C10.
            The per-page short disclaimer footer is injected by
            Puppeteer's footerTemplate in route.ts. */}
        <section
          data-section="disclaimer"
          className="break-before-page break-inside-avoid"
        >
          <SectionStub name="disclaimer (C10)" />
        </section>
      </main>
    </div>
  );
}

export default PrintBrief;

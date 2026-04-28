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
import {
  formatPTDateLong,
  formatPTTimeShort,
} from "@/lib/format-pt";

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

export function PrintBrief({
  briefing,
  stories,
  thesesCount,
  vix,
}: PrintBriefProps) {
  const dateStr = formatPTDateLong(briefing.created_at ?? null);
  const kind = briefing.briefing_type;
  const editionLabel = kind === "evening" ? "Evening Wrap" : "Morning Brief";

  // Commit 2 will rewrite PrintMasthead with a slim interface. While the
  // rebuild is in progress, pass through the existing legacy props so
  // the build stays green commit-by-commit.
  return (
    <div
      data-print-brief-root
      data-briefing-id={briefing.id}
      data-briefing-type={kind}
      className="bg-white text-black"
    >
      <PrintMasthead
        kind={kind}
        generatedAtIso={briefing.created_at}
        dateStr={dateStr}
        timeStr={formatPTTimeShort(briefing.created_at ?? null)}
        moodWord={
          briefing.market_pulse?.sentiment_word || briefing.market_tone || "—"
        }
        tone="NEUTRAL"
        storyCount={stories.length}
        thesesCount={thesesCount}
        vix={vix}
      />
      <main className="px-8 py-8 text-sm leading-relaxed">
        <p className="font-serif italic text-neutral-600">
          Newsletter rebuild in progress — sections will be filled in by
          subsequent commits.
        </p>
        <p className="mt-2 text-xs text-neutral-500">
          {editionLabel} · {dateStr} ·{" "}
          {briefing.headline ? stripHtml(briefing.headline) : "—"}
        </p>
      </main>
    </div>
  );
}

export default PrintBrief;

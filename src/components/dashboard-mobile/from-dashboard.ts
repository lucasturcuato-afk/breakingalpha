/**
 * The mobile Dashboard's loader, as a pure mapping.
 *
 * `/dashboard` already reads counts, the signals spark, the latest briefing,
 * top stories and the market band for the desktop layout. This module takes
 * that output, plus the reader's own record and the desk's, and shapes it into
 * `DashboardData`. Nothing here fetches, so it is testable without a renderer
 * and the desktop loaders are not rewired to feed it.
 *
 * THE ONE RULE IN THIS FILE. A field with no source is null. There is no
 * fallback string anywhere below, no default count and no stand-in date,
 * because every one of those reads to a signed-in reader as a measured fact
 * about their own morning.
 *
 * Compliance: counts only. Nothing here divides one count by another.
 */

import { sentimentToTone, type SentimentTone } from "@/components/ui/sentiment-pill";
import { formatChange, type DisplayUnit } from "@/lib/format-change";
import type { Resolution } from "@/lib/desk-record";
import type { DashboardData, DashMarketCell, DashStory } from "./fixture";
import {
  DASH_BRIEF_TITLE,
  DASH_DESK_RECORD_INTRO,
  DASH_DISCLAIMER,
  DASH_WAITING_EYEBROW,
  DASH_YOUR_RECORD_INTRO,
} from "./copy";

/**
 * What the market API puts in `value` when it could not price a symbol. An em
 * dash, written as an escape because the repo forbids the literal character.
 */
const UNPRICED = "\u2014";

/** One quote as `/api/market-indices` gives it back to the desktop page. */
export interface DashQuote {
  symbol: string;
  label: string;
  value: string;
  pct: number;
  change?: number;
  displayUnit?: DisplayUnit;
  closed?: boolean;
}

/** The subset of a top-stories row the mobile screen paints. */
export interface DashSourceStory {
  id: string;
  title: string;
  source: string;
  /** Already humanised by the page, e.g. "2h ago". */
  timestamp: string;
  sentiment: string;
  sector?: string;
  industry_verticals?: string[];
  tags?: string[];
}

export interface DashboardSources {
  /** Read once, at the moment the screen is built. */
  now: Date;
  firstName: string | null;
  storyCount: number;
  bullishCount: number;
  bearishCount: number;
  countsFailed: boolean;
  /** The symbols the reader chose, in their order. */
  marketSymbols: string[];
  /** Keyed by upper-case symbol, exactly as the page keeps it. */
  quotes: Record<string, DashQuote | null | undefined>;
  briefHeadline: string | null;
  stories: DashSourceStory[];
  watchlistTickers: string[];
  profileSectors: string[];
  /** The reader's own record. Null when it has not been read. */
  yourRecord: { byResolution: Record<Resolution, number>; awaiting: number } | null;
  /** The desk's record. Null when it has not been read. */
  deskRecord: { byResolution: Record<Resolution, number>; total: number } | null;
  /**
   * How many of the reader's own calls were graded in the last day. Null when
   * the record has not been read, which is a different thing from zero.
   */
  gradedInLastDay: number | null;
}

/* ── small, testable pieces ─────────────────────────────────────────── */

export function timeOfDay(now: Date): "morning" | "afternoon" | "evening" {
  const h = now.getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

/** "Thursday, August 6". The design's format, from the real clock. */
export function dashDate(now: Date): string {
  return now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

/**
 * "6:52 AM". The design prints a bare "6:52", which is unambiguous only
 * because the prototype is frozen at dawn. A real clock is read at any hour,
 * so the meridiem stays.
 */
export function dashClock(now: Date): string {
  return now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** One letter, from the only name the profile carries. Null when unknown. */
export function initialsFor(firstName: string | null): string | null {
  const trimmed = (firstName ?? "").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 1).toUpperCase();
}

const TONE_LABEL: Record<SentimentTone, string> = {
  BULLISH: "Bullish",
  BEARISH: "Bearish",
  NEUTRAL: "Neutral",
  MIXED: "Mixed",
  WATCH: "Watch",
};

/** "2h ago" is the desk's phrasing; the mobile row has a column for "2h". */
function shortAge(timestamp: string): string {
  return timestamp.replace(/\s*ago$/i, "");
}

function sectorMatches(sector: string | undefined, profileSectors: string[]): boolean {
  if (!sector) return false;
  const lower = sector.toLowerCase();
  return profileSectors.some((ps) => {
    const pl = ps.trim().toLowerCase();
    if (!pl) return false;
    return lower.includes(pl) || pl.includes(lower);
  });
}

/**
 * Whether a story survives the For You lens.
 *
 * The same two inputs the desk scores its own For You tab on: the reader's
 * watchlist tickers and their chosen sectors. With neither set, nothing
 * matches, and the lens says so rather than passing the whole list through
 * under a personalised label.
 */
export function isForYou(
  story: DashSourceStory,
  watchlistTickers: string[],
  profileSectors: string[],
): boolean {
  const wanted = new Set(watchlistTickers.map((t) => t.trim().toUpperCase()).filter(Boolean));
  for (const tag of story.tags ?? []) {
    if (wanted.has(tag.trim().toUpperCase())) return true;
  }
  if (sectorMatches(story.sector, profileSectors)) return true;
  for (const vertical of story.industry_verticals ?? []) {
    if (sectorMatches(vertical, profileSectors)) return true;
  }
  return false;
}

export function toDashStory(
  story: DashSourceStory,
  index: number,
  watchlistTickers: string[],
  profileSectors: string[],
): DashStory {
  const tone = sentimentToTone(story.sentiment);
  return {
    id: story.id,
    ordinal: index + 1,
    /* The gold rule marks an unread row. There is no read-state source on this
       route: the desktop loader stamps `read: false` on every row it maps, so
       marking them all unread would be that stamp rendered as a fact. No row
       is marked until something records what the reader has opened. */
    unread: false,
    forYou: isForYou(story, watchlistTickers, profileSectors),
    tone,
    toneLabel: TONE_LABEL[tone],
    sector: story.sector ?? story.industry_verticals?.[0] ?? null,
    source: story.source,
    age: shortAge(story.timestamp),
    headline: story.title,
  };
}

/**
 * The market band.
 *
 * A symbol the feed never answered on is left out entirely. Drawing it as
 * "no quote" would say the feed answered and had nothing, which is the same
 * class of mistake as printing "0.00%" for an unpriced instrument. "no quote"
 * and "last close" are kept for what they actually mean, matching
 * `stat-card.tsx` word for word.
 */
export function toMarketCells(sources: DashboardSources): DashMarketCell[] {
  const cells: DashMarketCell[] = [];
  for (const symbol of sources.marketSymbols) {
    if (symbol === "SIGNALS") {
      if (sources.countsFailed) {
        cells.push({
          symbol: "SIGNALS",
          label: "SIGNALS TODAY",
          value: "no count",
          note: "counts unavailable",
        });
        continue;
      }
      cells.push({
        symbol: "SIGNALS",
        label: "SIGNALS TODAY",
        value: String(sources.storyCount),
        counts: { up: `${sources.bullishCount}↑`, down: `${sources.bearishCount}↓` },
      });
      continue;
    }

    const quote = sources.quotes[symbol.toUpperCase()];
    if (!quote) continue;

    const label = quote.label.toUpperCase();
    if (quote.value === UNPRICED) {
      cells.push({ symbol, label, value: quote.value, note: "no quote" });
      continue;
    }
    if (quote.closed) {
      cells.push({ symbol, label, value: quote.value, note: "last close" });
      continue;
    }
    /* formatChange is the desk's own formatter. Sharing it is what stops the
       phone and the desk quoting the same instrument two different ways. */
    const change = formatChange({ pct: quote.pct, change: quote.change, unit: quote.displayUnit });
    cells.push({
      symbol,
      label,
      value: quote.value,
      delta: change.text,
      tone: change.isPositive ? "up" : "down",
    });
  }
  return cells;
}

/**
 * The overnight line, from the reader's own graded outcomes.
 *
 * Null when nothing of theirs was graded, and null again when the record has
 * not been read at all. The card is the design's most quotable sentence and
 * the easiest one to fabricate, so it is drawn only from a count.
 */
export function toWaiting(gradedInLastDay: number | null): { eyebrow: string; line: string } | null {
  if (gradedInLastDay === null || gradedInLastDay <= 0) return null;
  return {
    eyebrow: DASH_WAITING_EYEBROW,
    line:
      gradedInLastDay === 1
        ? "One of your calls was checked."
        : `${gradedInLastDay} of your calls were checked.`,
  };
}

/** The greeting's second line, or nothing at all. */
export function toContext(storyCount: number, countsFailed: boolean): string | null {
  if (countsFailed || storyCount <= 0) return null;
  return `${storyCount} high-signal stories worth your attention.`;
}

/* ── the whole screen ───────────────────────────────────────────────── */

export function buildDashboardData(sources: DashboardSources): DashboardData {
  const part = timeOfDay(sources.now);
  const name = (sources.firstName ?? "").trim();
  return {
    date: dashDate(sources.now),
    clock: dashClock(sources.now),
    eyebrow: `Your ${part} briefing`,
    greeting: name ? `Good ${part}, ${name}.` : `Good ${part}.`,
    initials: initialsFor(sources.firstName),
    context: toContext(sources.storyCount, sources.countsFailed),
    market: toMarketCells(sources),
    waiting: toWaiting(sources.gradedInLastDay),
    brief: { title: DASH_BRIEF_TITLE, sub: sources.briefHeadline },
    yourRecord: sources.yourRecord
      ? { intro: DASH_YOUR_RECORD_INTRO, ...sources.yourRecord }
      : null,
    deskRecord: sources.deskRecord
      ? { intro: DASH_DESK_RECORD_INTRO, ...sources.deskRecord }
      : null,
    stories: sources.stories.map((s, i) =>
      toDashStory(s, i, sources.watchlistTickers, sources.profileSectors),
    ),
    /* There is no source that can tell this screen it is looking at
       yesterday's briefing. The desktop page does not read the briefing's
       date and this loader does not add a read to find out, so the notice
       stays unpublished rather than guessed at. */
    staleNotice: null,
    disclaimer: DASH_DISCLAIMER,
  };
}

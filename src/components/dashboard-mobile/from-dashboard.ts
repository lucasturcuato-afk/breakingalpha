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
  DASH_DISCLAIMER,
  DASH_WAITING_EYEBROW,
  DASH_YOUR_RECORD_INTRO,
  deskRecordIntro,
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
  activity_types?: string[];
  tags?: string[];
}

export interface DashboardSources {
  /** Read once, at the moment the screen is built. */
  now: Date;
  firstName: string | null;
  /**
   * The three count reads, and null when the read has NOT ANSWERED.
   *
   * Null and zero are different facts and the screen states them differently.
   * `countsFailed` covers a read that came back with an error; these cover a
   * read still in flight when the screen was forced to paint. Both were 0 with
   * `countsFailed === false` before, so a timed-out load printed
   * "SIGNALS TODAY 0 / 0 up 0 down" over three queries that had returned
   * nothing at all.
   */
  storyCount: number | null;
  bullishCount: number | null;
  bearishCount: number | null;
  countsFailed: boolean;
  /** The symbols the reader chose, in their order. */
  marketSymbols: string[];
  /** Keyed by upper-case symbol, exactly as the page keeps it. */
  quotes: Record<string, DashQuote | null | undefined>;
  briefHeadline: string | null;
  /**
   * Null when the Top Stories read has not answered, "failed" when it answered
   * with an error, an array when it answered. An empty array means it answered
   * and had nothing, which is the only case the screen may say so in words.
   */
  stories: DashSourceStory[] | null | "failed";
  watchlistTickers: string[];
  profileSectors: string[];
  /** The reader's own record. Null when it has not been read. */
  yourRecord: {
    byResolution: Record<Resolution, number>;
    awaiting: number;
    /** Context entries: never price-checked, no verdict coming. Not a bucket. */
    context: number;
  } | null;
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
 * The reader's watchlist tickers and their chosen sectors, matched against the
 * story's tags, its sector and both halves of the dual-dimension taxonomy. With
 * neither set, nothing matches, and the lens says so rather than passing the
 * whole list through under a personalised label.
 *
 * NOT THE SAME OPERATION AS THE DESK'S. `sortByRelevance` on `/dashboard`
 * SCORES and RE-ORDERS, and never removes a story; this FILTERS. Same inputs,
 * different verb, and the difference is deliberate: a phone list is four rows
 * deep, so an ordering the reader has to scroll past is not a lens. It is
 * stated here because an earlier version of this comment claimed the two were
 * the same operation and they are not.
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
  /* The desk's own scorer reads `activity_types` alongside the verticals and
     this lens did not, so a story the desk counted as personal could be set
     aside on the phone. The dual-dimension taxonomy is two JSONB arrays and
     both of them are the reader's sectors' business. */
  for (const activity of story.activity_types ?? []) {
    if (sectorMatches(activity, profileSectors)) return true;
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
      /* A count that has not come back is left out entirely, exactly as an
         unanswered quote is. "no count" is the marker for a read that failed;
         this cell has not failed, it simply has no answer yet, and neither
         "no count" nor a zero is a true thing to print over it. */
      if (
        sources.storyCount === null ||
        sources.bullishCount === null ||
        sources.bearishCount === null
      ) {
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
export function toContext(storyCount: number | null, countsFailed: boolean): string | null {
  if (storyCount === null || countsFailed || storyCount <= 0) return null;
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
    /* The bars clause is appended only when the record has entries, because
       that is exactly when the bars draw. `deskRecordIntro` owns that test. */
    deskRecord: sources.deskRecord
      ? { intro: deskRecordIntro(sources.deskRecord.total > 0), ...sources.deskRecord }
      : null,
    /* Null and "failed" pass straight through to the screen, which draws no
       Top Stories section on the first and a failed section on the second.
       Mapping either to `[]` here would reach the empty state, and the empty
       state says "The overnight read has not published", which is a claim
       about the desk that neither an outstanding read nor a broken one can
       support. */
    stories:
      sources.stories === null || sources.stories === "failed"
        ? sources.stories
        : sources.stories.map((s, i) =>
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

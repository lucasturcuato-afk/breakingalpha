/**
 * The mapping layer between `/evening-wrap`'s real loaders and the mobile
 * screen's data contract.
 *
 * `fixture.ts` said the shape below IS the contract a loader has to satisfy.
 * This module is that loader's other half: the page keeps its own reads
 * untouched and hands the values it already resolved to `wrapFromBriefing`,
 * which reshapes them and does nothing else. No fetch happens here and no
 * value is invented here.
 *
 * THE RULE THIS MODULE ENFORCES. Every optional field answers `null` when its
 * source is absent, and the screen draws nothing for a null. Nothing in here
 * substitutes a stand-in, a stock sentence or a rounded figure for a value
 * the page did not actually resolve. A field with no source is missing on the
 * screen, visibly, rather than present and untrue.
 *
 * Compliance: nothing computed here aggregates outcomes into a single figure.
 * The counts are counts, the index cells are one instrument's move over one
 * session, and the reading time is a word count divided by a reading speed.
 */

import { stripHtml } from "@/lib/strip-html";
import type {
  EveningMover,
  EveningStat,
  EveningWrapData,
  ScorecardCell,
} from "./fixture";

/** Words a minute, for the masthead's reading estimate. */
const WORDS_PER_MINUTE = 200;

/**
 * One index cell's level, as the hero prints it.
 *
 * The desk grid formats the same cell inline at
 * `src/app/evening-wrap/page.tsx`, and this is deliberately a SECOND copy of
 * the yield rule rather than a shared call. The desk copy opens with a dash
 * glyph for a cell whose quote did not resolve, and this path
 * never reaches that branch: the page drops an unresolved cell instead of
 * drawing one, so the mobile grid has six cells or five or none, never a cell
 * standing in for a number nobody measured. Extracting the desk version would
 * have meant editing the desk render, and the desk render is out of scope for
 * this change.
 *
 * ^TNX on Yahoo's chart API has historically been quoted as the yield times
 * ten (42.50 = 4.25%). The API currently gives the yield directly; the guard
 * defends against a format regression either way.
 */
export function displayIndexLevel(sym: string, price: string): string {
  if (sym !== "^TNX") return price;
  const n = parseFloat(String(price).replace(/,/g, ""));
  if (isNaN(n)) return price;
  const normalized = n > 20 ? n / 10 : n;
  return `${normalized.toFixed(2)}%`;
}

/** How many story rows the mobile wrap lists. */
export const MOBILE_MOVER_LIMIT = 5;

/**
 * A `date` column rendered as the calendar day it stores.
 *
 * `resolve_on` is a Postgres `date`. It is three numbers, with no instant and
 * no zone behind them, and the row is written and queried against the
 * US-Pacific session calendar. `new Date("2026-08-31")` parses a bare date
 * string as UTC midnight, and every zone west of UTC then formats that instant
 * as the day before, so a reader in New York was shown `August 30` over a row
 * storing the 31st. That is a wrong date about a reader's own call.
 *
 * The fix is to never build a local instant out of it. The three numbers are
 * read straight off the string and the formatter is pinned to UTC, so the
 * rendered day is the stored day in every zone the app is read in. Anything
 * that is not a bare `YYYY-MM-DD` answers null, and the card then prints no
 * review date at all rather than a guessed one.
 *
 * Every other date on this screen comes from a real instant
 * (`briefing.created_at`, or the viewer's own clock) and is correctly
 * formatted in the viewer's zone. This is the only bare calendar date on the
 * surface: `new Date(` appears nowhere else under `src/components/evening/`.
 */
export function formatReviewDate(stored: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(stored.trim());
  if (!m) return null;
  const at = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(at)) return null;
  return new Date(at).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** One resolved scorecard cell, as the page's `snapshotCell` already gives it. */
export interface ResolvedIndexCell {
  label: string;
  /** Already formatted for display, including the yield's percent suffix. */
  price: string;
  pct: number;
  /**
   * Whether the move is the risk-on side of the tape. Comes apart from the
   * sign on the ten-year, which is why the page passes it rather than letting
   * this module guess.
   */
  favorable: boolean;
}

/** One story row, from the page's already-ranked rail. */
export interface ResolvedStory {
  /** A symbol off the article's own companies list, when it named one. */
  symbol?: string;
  headline: string;
  /** The session move for that symbol, when a quote resolved. */
  move?: string;
}

/** One open desk call for this session, straight off `morning_brief_calls`. */
export interface ResolvedCall {
  id: string;
  claim: string;
  symbol: string | null;
  /** The date the call is scored against, when the row carries one. */
  resolveOn: string | null;
}

export interface WrapSource {
  /** `briefing.created_at`, the session the wrap covers. */
  createdAt: string | null;
  /** The date the page already formatted, so both layouts agree on it. */
  datePretty: string;
  /** The clock the page already formatted, in the viewer's own zone. */
  timePretty: string;
  /** The reader's own sectors, for the personalization banner. */
  sectors: string[];
  /** `reconcileCloseWord`'s answer. Null when the tape could not ground one. */
  closeWord: string | null;
  /** Whether the close word reads as the risk-off side of the session. */
  closeIsStress: boolean;
  /** The close narrative, as HTML or prose. Empty when the brief carries none. */
  closeProse: string;
  /** The lead paragraph, which opens the stories block. */
  storyProse: string;
  /** How many stories the rail is carrying. */
  storyCount: number;
  /** Tracked theses, or null when the count read did not answer. */
  thesesCount: number | null;
  vix: { price: string; pct: number } | null;
  scorecard: ResolvedIndexCell[];
  movers: ResolvedStory[];
  /** The one open call this screen surfaces, and how many others are open. */
  reviewed: ResolvedCall | null;
  otherOpenCalls: number;
  /** Tomorrow's setup, as HTML or prose. */
  nextEventProse: string;
}

/**
 * Paragraph split that survives `stripHtml`.
 *
 * `stripHtml` collapses every run of whitespace, so a blank line is gone by
 * the time it has finished. The split therefore happens on the raw value
 * first, exactly as the desktop's own `tomorrowSetupEvents` does it, and each
 * piece is cleaned afterwards.
 */
export function proseParagraphs(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/<\/p>\s*<p[^>]*>|\n\s*\n+/)
    .map((p) => stripHtml(p).trim())
    .filter(Boolean);
}

/**
 * Peel the opening sentence off, so the screen can set it as its Playfair
 * lede. A single-sentence paragraph stays whole and the body is empty; the
 * screen then draws a lede and no body rather than an empty paragraph.
 */
export function splitLede(paragraphs: string[]): { lede: string; body: string[] } {
  if (paragraphs.length === 0) return { lede: "", body: [] };
  const [first, ...rest] = paragraphs;
  const match = first.match(/^([\s\S]+?[.!?])\s+([\s\S]+)$/);
  if (match && match[2].trim()) {
    return { lede: match[1].trim(), body: [match[2].trim(), ...rest] };
  }
  return { lede: first, body: rest };
}

/**
 * The stamp in the card's top right.
 *
 * A `morning_brief_calls` id is a uuid, and a uuid set in that slot is 36
 * mono characters that overrun the row and tell a reader nothing. The first
 * group is the conventional short form of a uuid and is what the row shows.
 * It is a prefix of the real id and not a scheme invented for the display, so
 * it cannot name a call that does not exist.
 */
function shortCallId(id: string): string {
  return id.split("-")[0].toUpperCase();
}

function wordCount(parts: string[]): number {
  return parts.join(" ").split(/\s+/).filter(Boolean).length;
}

function moveLabel(pct: number): string {
  return `${Math.abs(pct).toFixed(2)}%`;
}

function toScorecard(cells: ResolvedIndexCell[]): ScorecardCell[] {
  return cells.map((c) => ({
    label: c.label,
    value: c.price,
    move: moveLabel(c.pct),
    direction: c.pct >= 0 ? "up" : "down",
    tone: c.favorable ? "up" : "down",
  }));
}

function toStats(src: WrapSource): EveningStat[] {
  const stats: EveningStat[] = [];
  if (src.closeWord) {
    stats.push({
      label: "Close",
      value: src.closeWord.toUpperCase(),
      tone: src.closeIsStress ? "stress" : "calm",
    });
  }
  if (src.storyCount > 0) {
    stats.push({ label: "Movers", value: String(src.storyCount) });
  }
  if (src.thesesCount !== null) {
    stats.push({ label: "Theses", value: `${src.thesesCount} active` });
  }
  if (src.vix) {
    stats.push({
      label: "VIX",
      value: `${src.vix.price} ${src.vix.pct >= 0 ? "▲" : "▼"}${moveLabel(src.vix.pct)}`,
      /* Reads the figure, not the direction: a falling VIX is the calm side. */
      tone: src.vix.pct >= 0 ? "stress" : "calm",
    });
  }
  return stats;
}

function toMovers(src: WrapSource): EveningMover[] {
  const seen = new Set<string>();
  const out: EveningMover[] = [];
  for (const m of src.movers) {
    if (!m.headline) continue;
    if (m.symbol && seen.has(m.symbol)) continue;
    if (m.symbol) seen.add(m.symbol);
    out.push({ symbol: m.symbol, move: m.move, headline: m.headline });
    if (out.length === MOBILE_MOVER_LIMIT) break;
  }
  return out;
}

/**
 * The one open call, and the line about the others.
 *
 * `note` is the eyebrow. The design's own word there described what the
 * evidence did that evening, which nothing in the payload knows. `awaiting` is
 * what the row carries, and the reason is structural rather than a date
 * comparison: `morning_brief_calls` has no outcome column at all. Its columns
 * are id, brief_id, brief_date, claim_text, claim_type, target_symbol,
 * expected_direction, confidence, created_at, is_lead and resolve_on. Grading
 * is stored elsewhere and nothing on this path reads it, so no row reaching
 * here can carry a decided state and `awaiting` is the only state available.
 *
 * The previous version of this comment justified the eyebrow with "a review
 * date at or after today, which is the definition of awaiting". That reasoning
 * was off by one, in the same place the copy below was.
 *
 * `reasoning` is the row's own two facts, target and review date, and never a
 * sentence about what the call is doing.
 *
 * WHAT `reviewedRest` MAY SAY. The read behind `otherOpenCalls` is
 * `brief_date = this session AND resolve_on >= today`, and it is an exact
 * count rather than a page of rows, so the number is the number. That
 * establishes one thing: those calls have a review date that has not passed.
 * It does NOT establish that none of them has reached its review date, because
 * `>= today` includes a call whose review date IS today, and such a call has
 * reached it. The table carries rows resolving today right now, so this was
 * not exotic. The second sentence is therefore gone rather than reworded:
 * dropping an unsupported claim is the fix, and any softer version of it would
 * have been the same claim with a hedge on it.
 */
function toReviewed(src: WrapSource): {
  reviewed: EveningWrapData["reviewed"];
  reviewedRest: string | null;
} {
  const r = src.reviewed;
  if (!r) return { reviewed: null, reviewedRest: null };
  const facts: string[] = [];
  if (r.symbol) facts.push(`Target ${r.symbol}.`);
  if (r.resolveOn) {
    const pretty = formatReviewDate(r.resolveOn);
    if (pretty) facts.push(`Review date ${pretty}.`);
  }
  const others = src.otherOpenCalls;
  return {
    reviewed: {
      id: shortCallId(r.id),
      note: "Awaiting",
      claim: r.claim,
      reasoning: facts.join(" "),
    },
    reviewedRest:
      others > 0
        ? `${others} other call${others === 1 ? "" : "s"} from this session ${
            others === 1 ? "is" : "are"
          } still open.`
        : "No other call from this session is still open.",
  };
}

/**
 * Reshape one loaded wrap into the mobile screen's contract.
 *
 * Called only when the page actually has a briefing in hand. The absent,
 * failed and in-flight branches are the caller's to pick; this function never
 * manufactures a wrap out of nothing.
 */
export function wrapFromBriefing(src: WrapSource): EveningWrapData {
  const closeParagraphs = proseParagraphs(src.closeProse);
  const { lede: closeLede, body: closeBody } = splitLede(closeParagraphs);

  const storyParagraphs = proseParagraphs(src.storyProse);
  const rawStoryLede = storyParagraphs[0] ?? "";
  /* The close narrative and the lead paragraph are separate columns, and on a
     brief that carries only one of them the page's own chain can serve the
     same text to both. Printing it twice would read as an editing mistake. */
  const storyLede = rawStoryLede && rawStoryLede !== closeLede ? rawStoryLede : "";

  const movers = toMovers(src);
  const { reviewed, reviewedRest } = toReviewed(src);
  const nextEvent = proseParagraphs(src.nextEventProse)[0] ?? null;

  const words = wordCount([
    closeLede,
    ...closeBody,
    storyLede,
    ...movers.map((m) => m.headline),
    nextEvent ?? "",
  ]);

  return {
    readMinutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
    tagline: "How the session played out, and what it meant.",
    dateline: `Evening Wrap · ${src.datePretty}`,
    sectors: src.sectors,
    stats: toStats(src),
    close: {
      stampedAt: `THE CLOSE · ${src.timePretty.toUpperCase()}`,
      verdict: src.closeWord,
      scorecard: toScorecard(src.scorecard),
      lede: closeLede,
      body: closeBody,
    },
    reviewed,
    reviewedRest,
    stories: { lede: storyLede, movers },
    nextEvent,
    coversSession: src.datePretty,
  };
}

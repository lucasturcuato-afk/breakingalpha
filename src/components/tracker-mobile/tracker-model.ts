/**
 * The evidence tracker's mobile view model. Pure, no JSX, no client hooks, so
 * both screens and `tests/unit/tracker-mobile-model.test.ts` read the same
 * derivations.
 *
 * NOTHING HERE INVENTS A FIGURE. Every value is either a count of rows the
 * page already read or a difference between two dates on those rows. There is
 * no ratio, no rate and no aggregate anywhere in this module, and that is the
 * one property a reader of a graded-thesis tracker has to be able to check
 * quickly. The desktop page computes a `supportRate` for SORT ORDER only; it
 * is not passed through this module and it is not drawn on the phone.
 *
 * THE LEAN AND THE SETTLED STATE ARE TWO CHANNELS, and they are deliberately
 * not folded into one.
 *
 *   colour  follows the LEAN, through `OUTCOME_TOKENS`, so a thesis whose
 *           evidence is running against it reads the same hue whether the
 *           grader has settled it or not.
 *   word    comes from `verdictDisplayLabel`, which is what separates the
 *           settled state from the lean: "Supported" against "Leaning
 *           supportive", "Challenged" against "Leaning against".
 *
 * Painting the lean and reading the word gives both facts. Painting only one
 * of them was the temptation and it loses whichever it drops. The shipped
 * desktop already works this way: `liveScoreChipClasses` gives "Tracking
 * confirmed" the same `signal-up` hue as "Confirmed" and separates them by
 * weight and italic. This is that rule in the mobile token vocabulary.
 */

/* The direct path, not the `@/components/ledger` barrel. The barrel reaches
   `mobile-ticker-strip.tsx`, which imports a CSS module, and a CSS import
   under the unit runner is a syntax error rather than a no-op. This is the
   same import `tests/unit/outcome-edge-token.test.ts` already writes, and for
   the same reason. */
import { OUTCOME_LABEL, OUTCOME_TOKENS, type OutcomeState } from "@/components/ledger/claim-anatomy";
import {
  verdictDisplayLabel,
  verdictLean,
  type LiveScoreResult,
} from "@/lib/track-record-live-score";

/** One graded review of one thesis, reduced to what a phone draws. */
export interface TrackerReview {
  id: string;
  gradedAt: string;
  verdict: string;
  notes: string | null;
}

/** One thesis, as both mobile screens consume it. */
export interface TrackerThesis {
  id: string;
  title: string;
  sector: string | null;
  ticker: string | null;
  generatedAt: string | null;
  checkAfter: string | null;
  live: LiveScoreResult;
  reviews: TrackerReview[];
}

/** One row of the by-sector table. Counts only. */
export interface TrackerSectorRow {
  sector: string;
  count: number;
  lean: SectorLean;
}

export type SectorLean = "supportive" | "against" | "mixed" | "awaiting";

/** The lifecycle the screen can be in. Five, and each one is reachable. */
export type TrackerStage = "loading" | "error" | "empty" | "stale" | "ready";

/**
 * The colour pair a lean paints, and the word that goes beside it.
 *
 * The dot is a FILL and takes the base token; the word is TEXT and takes the
 * ink token. `OUTCOME_TOKENS` separates those two on purpose and this function
 * hands both halves back rather than one value a caller could put in either
 * slot.
 */
export function leanTokens(
  verdict: string,
  /** Whether ANY review has run. See the awaiting note below. */
  reviewed = true,
): { dot: string; text: string; word: string } {
  const lean = verdictLean(verdict);
  /* AWAITING IS NOT DEVELOPING, and a card that says both is lying on one of
     its two lines. `verdictDisplayLabel` answers "Developing" for every
     non-settled, non-leaning verdict, which fits a thesis three
     reviews in with nothing decided and wrong for one that has never been
     read: the mono line directly under it already says AWAITING FIRST REVIEW.
     `awaiting` is the fourth state in the closed set and the only one this
     screen would otherwise never draw, so the case that names it uses it. The
     word and the hue both come from the ledger's own tables; there is no
     second word table here. */
  if (reviewed === false && lean === "neutral") {
    return { ...OUTCOME_TOKENS.awaiting, word: OUTCOME_LABEL.awaiting };
  }
  const state: OutcomeState =
    lean === "supportive" ? "supported" : lean === "against" ? "challenged" : "developing";
  return { ...OUTCOME_TOKENS[state], word: verdictDisplayLabel(verdict) };
}

/** The same pair for a whole sector row. */
export function sectorLeanTokens(lean: SectorLean): { text: string; word: string } {
  if (lean === "supportive") return { text: OUTCOME_TOKENS.supported.text, word: "Supportive" };
  if (lean === "against") return { text: OUTCOME_TOKENS.challenged.text, word: "Against" };
  if (lean === "mixed") return { text: "var(--c-secondary)", word: "Mixed" };
  return { text: OUTCOME_TOKENS.awaiting.text, word: "Awaiting" };
}

/**
 * The sector table, from the theses themselves rather than from a second
 * query, so the row counts and the head count are the same universe.
 *
 * Sorted by count and then by name. NOT by any share of supportive rows: that
 * ordering is a ranking by a rate wearing a sort's clothes, and the reader
 * reads the top row as the best one.
 */
export function sectorRows(theses: TrackerThesis[]): TrackerSectorRow[] {
  const map = new Map<string, { count: number; up: number; down: number }>();
  for (const t of theses) {
    const key = t.sector || "Unknown";
    const cur = map.get(key) ?? { count: 0, up: 0, down: 0 };
    cur.count += 1;
    const lean = verdictLean(t.live.verdict);
    if (lean === "supportive") cur.up += 1;
    else if (lean === "against") cur.down += 1;
    map.set(key, cur);
  }
  const rows: TrackerSectorRow[] = [];
  for (const [sector, d] of map) {
    const lean: SectorLean =
      d.up > 0 && d.down === 0
        ? "supportive"
        : d.down > 0 && d.up === 0
          ? "against"
          : d.up > 0 && d.down > 0
            ? "mixed"
            : "awaiting";
    rows.push({ sector, count: d.count, lean });
  }
  rows.sort((a, b) => b.count - a.count || a.sector.localeCompare(b.sector));
  return rows;
}

/** The interpunct both screens join parts with. */
const DOT = "\u00b7";

/**
 * The mono line under a card: how many reviews, and where the thesis sits
 * against its own horizon. Both facts, never a third one interpolated between
 * them.
 */
export function horizonLine(t: TrackerThesis): string {
  const h = `${t.live.horizonDays}-DAY HORIZON`;
  if (t.reviews.length === 0) return `AWAITING FIRST REVIEW ${DOT} ${h}`;
  const reviews = `${t.reviews.length} ${t.reviews.length === 1 ? "REVIEW" : "REVIEWS"}`;
  if (t.live.terminal === "confirmed" || t.live.terminal === "invalidated") {
    return `${reviews} ${DOT} SETTLED ON A ${h}`;
  }
  const left = t.live.horizonDays - t.live.ageDays;
  if (left < 0) return `${reviews} ${DOT} ${-left} DAYS PAST A ${h}`;
  return `${reviews} ${DOT} ${left} ${left === 1 ? "DAY" : "DAYS"} LEFT ON A ${h}`;
}

/**
 * WHAT CLOSES THE DOT RAIL, and it is not always a ring.
 *
 * The prototype ends every rail with a hollow ring and a date, meaning "the
 * review that has not run yet". Drawn unconditionally that is false twice
 * over, and both were visible on the first build of this screen:
 *
 *   a SETTLED thesis is not graded again, so a ring promising another review
 *   is a reading that will never be taken.
 *   `check_after` is a stored date and nothing keeps it ahead of the reviews.
 *   A card measured on real rows read "AUG 1 (dot) ... (ring) JUL 31", a
 *   future review dated before the review that already happened.
 *
 * So the tail is derived rather than drawn: a ring only while the thesis is
 * open, and a trailing date only when there is one that is actually later than
 * the last reading on the rail.
 */
export function railTail(t: TrackerThesis): { ring: boolean; date: string | null } {
  const settled = t.live.terminal === "confirmed" || t.live.terminal === "invalidated";
  const last = t.reviews.length ? t.reviews[t.reviews.length - 1].gradedAt : null;
  if (settled) {
    /* The closing date is the last reading itself, and only when there is more
       than one, since a single dot is already labelled by the opening date. */
    return { ring: false, date: t.reviews.length > 1 ? shortDate(last) : null };
  }
  const later = t.checkAfter && (!last || t.checkAfter > last) ? t.checkAfter : null;
  return { ring: true, date: later ? shortDate(later) : null };
}

/**
 * The eyebrow over a card and over the detail head. Ticker first when the
 * thesis names an instrument, sector after it. A thesis with neither draws
 * nothing rather than a placeholder word.
 */
export function instrumentLine(t: {
  ticker: string | null;
  sector: string | null;
}): string | null {
  const parts = [t.ticker, t.sector].filter(Boolean) as string[];
  if (parts.length === 0) return null;
  return parts.join(` ${DOT} `).toUpperCase();
}

/**
 * STALE IS A FACT ABOUT THE REVIEW RUN, not about the reader's session.
 *
 * The grading cron fires nightly. Two windows with nothing written is the
 * point at which the newest reading on the screen stopped being last night's,
 * so 48 hours is the boundary and it is stated here once rather than at the
 * two draw sites. A tracker with no reviews at all is NOT stale: nothing has
 * failed to update, nothing has been graded yet, and `awaiting` already says
 * so on every card.
 */
export const STALE_AFTER_HOURS = 48;

export function isStale(lastReviewedIso: string | null, now: Date): boolean {
  if (!lastReviewedIso) return false;
  const t = new Date(lastReviewedIso).getTime();
  if (Number.isNaN(t)) return false;
  return now.getTime() - t > STALE_AFTER_HOURS * 3600 * 1000;
}

/** Short date, the one both screens draw in the mono voice. */
export function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toUpperCase();
}

/** Long date with the clock, for the detail head and the timeline. */
export function longDateTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

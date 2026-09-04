/**
 * The tone-over-time strip in the mobile Price and tone section.
 *
 * WHY THIS IS FOUR WEEKLY BANDS AND NOT A SPARKLINE, which is what desktop
 * draws and what the obvious port would have been.
 *
 * `/api/company-trend` gives back one point per UTC day: a mean of per-mention
 * sentiment over that day, and the count behind it. Desktop plots those points
 * on a signed -1..+1 axis. Measured over the live corpus on a 30-day window,
 * the median company that carries any scored mention at all reaches only a
 * HANDFUL of distinct days, and even the deepest company in the corpus is empty
 * on most days of the window. A line through a handful of points spread over a
 * 30-day axis is not a chart, it is a few dots and a lot of interpolation.
 *
 * The second measurement is the one that settled the form. NEARLY HALF of live
 * company-days in that window carry EXACTLY ONE scored mention, and the mean of
 * a single mention is exactly -1, 0 or +1. So on a signed axis, nearly half of
 * every series is drawn at full deflection by one article. A reader cannot tell
 * that spike from a week of consistent negative coverage, and the smaller the
 * company the more of its line is made of them. That is drawing noise as
 * signal, on precisely the companies where a reader has the least other
 * information to correct it with.
 *
 * The repo already had the answer. `src/lib/tone.ts` will not state a level at
 * all under `LEVEL_MIN_N` scored mentions, because that is where it judged a
 * mean to mean something. This module applies that same floor to a seven-day
 * band: a band that clears it is drawn as a level on the same five-step scale
 * with the same calibrated cuts, and a band that does not clear it is drawn as
 * an explicit void. Nothing is interpolated across a void, because there is
 * nothing to interpolate from.
 *
 * WHAT THAT COSTS AND WHAT IT GAINS. Measured over the same 28 days, the strip
 * draws for a little under three fifths of the companies a two-points-or-more
 * sparkline would have drawn for. It reaches fewer, and every one it reaches is
 * built out of readings the app already considers statable. It also still
 * reaches past the quote line that shares this section: roughly one in seven of
 * the companies it draws for carry no symbol at all, and only a minority of the
 * companies with any scored mention in the window carry one.
 *
 * NOTHING HERE DIVIDES INTO A RATE. A band mean is a LEVEL, the same quantity
 * the headline above it states in words, and it is never rendered as a figure.
 * The counts that reach the screen are counts of mentions and stay counts.
 */

import { LEVEL_MIN_N, levelOf, levelPolarity, levelToLabel } from "@/lib/tone";
import type { TonePolarity } from "@/lib/tone";

/** One day of the series, as `/api/company-trend` gives it back. */
export interface ToneSeriesPoint {
  date: string;
  score: number;
  n: number;
}

/** The route's body. Mirrors `ToneTrendResponse` without importing a route. */
export interface ToneSeriesBody {
  company: string;
  range: string;
  rangeStart: string;
  points: ToneSeriesPoint[];
}

/** Days per band. One week, so a band boundary is a thing a reader can name. */
export const BAND_DAYS = 7;

/** How many bands the strip draws. Four weeks of the 30-day window. */
export const BAND_COUNT = 4;

/**
 * Bands that must carry a reading before the strip draws at all.
 *
 * ONE IS NOT A SERIES. A single lit band beside three voids restates the
 * headline directly above it and adds three empty boxes, which is the same
 * absence said twice. Two is the smallest strip that can show a change.
 */
export const MIN_READABLE_BANDS = 2;

/** The range asked of the route. The strip uses the trailing 28 days of it. */
export const SERIES_RANGE = "30d";

/** Days in `SERIES_RANGE`, used to fix "now" without reading the clock. */
const SERIES_RANGE_DAYS = 30;

const DAY_MS = 86_400_000;

/** Copy for a read that did not answer. Never conflated with an empty read. */
export const SERIES_FAILED_COPY = "tone history read failed";

/**
 * One position on the strip.
 *
 * A void is not a zero and it is not a gap in a line. It is a week whose
 * mention count did not clear `LEVEL_MIN_N`, which is the same bar the headline
 * clears before it will name a level.
 */
export type ToneBand =
  | { kind: "void"; mentions: number }
  | {
      kind: "reading";
      polarity: TonePolarity;
      /** -2..+2. The five-step scale, as a signed height off the midline. */
      step: number;
      /** "Strongly Positive" and the other four. Read out, not drawn. */
      label: string;
      mentions: number;
    };

export type ToneSeriesView =
  /** Too little to draw honestly. The headline has already said so. */
  | { kind: "absent" }
  /** The read is in flight. Draws nothing and reserves nothing, at any age. */
  | { kind: "pending" }
  /** The read did not answer. A different fact from an empty one. */
  | { kind: "failed" }
  | {
      kind: "drawn";
      /** Oldest first, so the strip reads left to right like a sentence. */
      bands: ToneBand[];
      readable: number;
      /** Names the window and the count behind it. Never a rate. */
      caption: string;
      /** The whole strip, in words, for a reader who cannot see it. */
      announcement: string;
    };

/** The five levels as signed steps off the neutral midline. */
const LEVEL_STEP: Record<string, number> = {
  STRONGLY_POSITIVE: 2,
  POSITIVE: 1,
  MIXED: 0,
  NEGATIVE: -1,
  STRONGLY_NEGATIVE: -2,
};

/**
 * The UTC day an instant falls in, as an integer day number.
 *
 * BOTH SIDES OF THE AGE COMPARISON ARE SNAPPED THE SAME WAY, and that is the
 * whole point of this function existing. An earlier draft compared a derived
 * "now" still carrying the route's wall clock against each day pinned to 12:00
 * UTC, so for every answer before noon UTC the current day came out with a
 * NEGATIVE age and was skipped: for half of every day the newest band rendered
 * void with a count of zero and the day's whole mention set went missing.
 * Reduced to day numbers there is no hour left to disagree about, and an age is
 * an exact integer count of days.
 */
function utcDayNumber(ms: number): number {
  return Math.floor(ms / DAY_MS);
}

/**
 * A day's weighted contribution, with the float drift taken back out.
 *
 * The route hands back `score` as a per-day MEAN of per-mention sentiment in
 * {-1, 0, +1} over `n` mentions, so `score * n` is an integer by construction:
 * the count of bullish mentions minus the count of bearish ones. Rebuilt
 * through a float mean it is that integer plus a few parts in 10^16, which is
 * enough to carry a band mean sitting exactly on a calibrated cut across it and
 * draw one step harsher than `computeTone` over the identical labels. Snapped
 * back when it is within a whisker of an integer, and left alone when it is
 * not, so a caller handing back some other grain of score is never distorted.
 */
function weightedDay(score: number, n: number): number {
  const raw = score * n;
  const nearest = Math.round(raw);
  return Math.abs(raw - nearest) < 1e-6 ? nearest : raw;
}

/**
 * Fold daily points into `BAND_COUNT` weekly bands, newest band first.
 *
 * "NOW" IS DERIVED, NEVER READ FROM THE CLOCK. `rangeStart` is the route's own
 * `now - range days`, so `rangeStart + range days` is the instant the route
 * answered. Taking it from the body rather than from `Date.now()` keeps this
 * pure, keeps a render deterministic, and is the same trick the desktop chart
 * uses to fix its right edge. It is also the only correct choice: the reader's
 * clock and the route's clock are not the same clock.
 *
 * The mean is rebuilt at MENTION grain, not at day grain. A band's score is
 * `sum(score_d * n_d) / sum(n_d)`, which is the mean over every mention in the
 * band. Averaging the daily means instead would weight a day carrying one
 * mention the same as a day carrying eighty, and this corpus has both.
 */
function foldToBands(
  points: ToneSeriesPoint[],
  nowMs: number,
): Array<{ sum: number; n: number }> {
  const acc = Array.from({ length: BAND_COUNT }, () => ({ sum: 0, n: 0 }));
  const nowDay = utcDayNumber(nowMs);

  for (const p of points) {
    if (!p || typeof p.n !== "number" || p.n <= 0) continue;
    if (typeof p.score !== "number" || !Number.isFinite(p.score)) continue;
    // Midday UTC, so a date-only string cannot land on the wrong side of a
    // boundary through an offset before it is reduced to a day number.
    const dayMs = Date.parse(`${p.date}T12:00:00Z`);
    if (!Number.isFinite(dayMs)) continue;
    // An exact integer. The current day is 0 at every hour the route can answer.
    const ageDays = nowDay - utcDayNumber(dayMs);
    if (ageDays < 0) continue;
    const band = Math.floor(ageDays / BAND_DAYS);
    if (band < 0 || band >= BAND_COUNT) continue;
    acc[band].sum += weightedDay(p.score, p.n);
    acc[band].n += p.n;
  }
  return acc;
}

/** "1 mention" / "12 mentions". The unit `formatEvidence` already uses. */
function plural(n: number): string {
  return `${n} ${n === 1 ? "mention" : "mentions"}`;
}

/** Names the window and the total. A count, and it stays a count. */
export function buildSeriesCaption(totalMentions: number): string {
  return `${BAND_COUNT} weeks, oldest first · ${plural(totalMentions)}`;
}

/** What the client component knows at the moment it renders. */
export interface ToneSeriesInput {
  phase: "pending" | "answered" | "failed";
  body?: ToneSeriesBody | null;
}

/**
 * The single decision the strip makes.
 *
 * A FAILED READ IS NEVER AN EMPTY ONE. `phase: "failed"` and a body with no
 * points are different facts about different worlds, and the standing rule on
 * this screen is that they must not render as each other. An empty read means
 * this company has too little scored coverage to draw four weeks of it, which
 * the headline above has already said in words, so the strip stands down
 * entirely. A failed read means the screen does not know, and it says so.
 *
 * A MALFORMED 200 IS ALSO A READ THAT DID NOT ANSWER. The transport succeeding
 * says nothing about the body being a body. Before the `rangeStart` check
 * below, a 200 carrying an unparseable window start folded into four empty
 * bands, fell under `MIN_READABLE_BANDS` and drew as `absent`, which is
 * pixel-identical to a company with genuinely too little coverage. Same rule,
 * broken a second way, so the shape is checked before it is trusted.
 */
export function toneSeriesView(input: ToneSeriesInput): ToneSeriesView {
  if (input.phase === "pending") return { kind: "pending" };
  if (input.phase === "failed" || !input.body) return { kind: "failed" };
  if (!Array.isArray(input.body.points)) return { kind: "failed" };

  const startMs =
    typeof input.body.rangeStart === "string" ? Date.parse(input.body.rangeStart) : NaN;
  if (!Number.isFinite(startMs)) return { kind: "failed" };

  const acc = foldToBands(input.body.points, startMs + SERIES_RANGE_DAYS * DAY_MS);

  // Oldest first. The route hands the series back ascending and a reader reads
  // left to right, so the strip runs the same way the sentence above it does.
  const bands: ToneBand[] = acc
    .slice()
    .reverse()
    .map((b) => {
      if (b.n < LEVEL_MIN_N) return { kind: "void", mentions: b.n } as ToneBand;
      const level = levelOf(b.sum / b.n);
      return {
        kind: "reading",
        polarity: levelPolarity(level),
        step: LEVEL_STEP[level] ?? 0,
        label: levelToLabel(level),
        mentions: b.n,
      } as ToneBand;
    });

  const readable = bands.filter((b) => b.kind === "reading").length;
  if (readable < MIN_READABLE_BANDS) return { kind: "absent" };

  const total = bands.reduce((s, b) => s + b.mentions, 0);

  // Oldest week first, matching the drawing exactly, so what is read out and
  // what is drawn cannot come apart.
  const spoken = bands
    .map((b, i) => {
      const weeksAgo = BAND_COUNT - i;
      const when = weeksAgo === 1 ? "the past week" : `${weeksAgo} weeks ago`;
      return b.kind === "reading"
        ? `${when}, ${b.label}, ${plural(b.mentions)}`
        : `${when}, no reading, ${plural(b.mentions)}`;
    })
    .join(". ");

  return {
    kind: "drawn",
    bands,
    readable,
    caption: buildSeriesCaption(total),
    announcement: `Tone by week, oldest first. ${spoken}.`,
  };
}

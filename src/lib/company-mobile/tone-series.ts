/**
 * The tone-over-time strip in the mobile Price and tone section.
 *
 * WHY THIS IS FOUR WEEKLY BANDS AND NOT A SPARKLINE, which is what desktop
 * draws and what the obvious port would have been.
 *
 * `/api/company-trend` gives back one point per UTC day: a mean of per-mention
 * sentiment over that day, and the count behind it. Desktop plots those points
 * on a signed -1..+1 axis. Measured over the live corpus on a 30-day window,
 * 1,798 companies carry at least one scored mention and their median depth is
 * THREE distinct days. p75 is 12, the deepest company in the corpus reaches 23
 * of 30. A line through three points spread over a 30-day axis is not a chart,
 * it is three dots and a lot of interpolation.
 *
 * The second measurement is the one that settled the form. 44.1% of all
 * company-days in that window carry EXACTLY ONE scored mention, and the mean of
 * a single mention is exactly -1, 0 or +1. So on a signed axis, nearly half of
 * every series is drawn at full deflection by one article. A reader cannot tell
 * that spike from a week of consistent negative coverage, and the smaller the
 * company the more of its line is made of them. That is drawing noise as
 * signal, on precisely the companies where a reader has the least other
 * information to correct it with.
 *
 * The repo already had the answer. `src/lib/tone.ts` will not state a level at
 * all under `LEVEL_MIN_N` scored mentions, because three is where it judged a
 * mean to mean something. This module applies that same floor to a seven-day
 * band: a band that clears it is drawn as a level on the same five-step scale
 * with the same +-0.20 / +-0.60 cuts, and a band that does not clear it is
 * drawn as an explicit void. Nothing is interpolated across a void, because
 * there is nothing to interpolate from.
 *
 * WHAT THAT COSTS AND WHAT IT GAINS. Measured over the same 28 days: a
 * two-points-or-more sparkline would draw for 1,144 companies, and a
 * two-readable-bands-or-more strip draws for 672. The strip reaches fewer, and
 * every one it reaches is built out of readings the app already considers
 * statable. It also still reaches past the quote line that shares this section:
 * 95 of those 672 carry no symbol at all, and only 774 companies in the same
 * window carry one.
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
  /** The read is in flight. `announce` gates the only visible pending copy. */
  | { kind: "pending"; announce: boolean }
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
function foldToBands(body: ToneSeriesBody): Array<{ sum: number; n: number }> {
  const startMs = Date.parse(body.rangeStart);
  const days = Number.isFinite(startMs) ? SERIES_RANGE_DAYS : 0;
  const nowMs = startMs + days * DAY_MS;

  const acc = Array.from({ length: BAND_COUNT }, () => ({ sum: 0, n: 0 }));
  if (!Number.isFinite(startMs)) return acc;

  for (const p of body.points) {
    if (!p || typeof p.n !== "number" || p.n <= 0) continue;
    if (typeof p.score !== "number" || !Number.isFinite(p.score)) continue;
    // Midday UTC, matching the desktop chart, so a date string cannot land on
    // the wrong side of a boundary through a timezone offset.
    const dayMs = Date.parse(`${p.date}T12:00:00Z`);
    if (!Number.isFinite(dayMs)) continue;
    const ageDays = (nowMs - dayMs) / DAY_MS;
    if (ageDays < 0) continue;
    const band = Math.floor(ageDays / BAND_DAYS);
    if (band < 0 || band >= BAND_COUNT) continue;
    acc[band].sum += p.score * p.n;
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
  /** Milliseconds the read has been in flight. Only consulted while pending. */
  elapsedMs?: number;
}

/**
 * How long a read may run before the strip admits it is reading.
 *
 * Same gate and same reasoning as the quote line at the head of this section:
 * a shimmer over a fast read is a drawing of a load rather than a load. Unlike
 * that line, this block reserves NO height while it waits, and the reason is
 * that it sits BELOW the tone level rather than above it. Reserving would gain
 * nothing for the level, which cannot move either way, and would cost a
 * collapse on the majority of companies, where the strip resolves to `absent`
 * and the reserved box has to disappear. A push down on the caveat paragraph
 * under it is the cheaper of the two.
 */
export const SERIES_PENDING_ANNOUNCE_MS = 600;

/** The one line the pending case may draw, once it has earned it. */
export const SERIES_PENDING_COPY = "reading tone history";

/**
 * The single decision the strip makes.
 *
 * A FAILED READ IS NEVER AN EMPTY ONE. `phase: "failed"` and a body with no
 * points are different facts about different worlds, and the standing rule on
 * this screen is that they must not render as each other. An empty read means
 * this company has too little scored coverage to draw four weeks of it, which
 * the headline above has already said in words, so the strip stands down
 * entirely. A failed read means the screen does not know, and it says so.
 */
export function toneSeriesView(input: ToneSeriesInput): ToneSeriesView {
  if (input.phase === "pending") {
    return { kind: "pending", announce: (input.elapsedMs ?? 0) >= SERIES_PENDING_ANNOUNCE_MS };
  }
  if (input.phase === "failed" || !input.body) return { kind: "failed" };
  if (!Array.isArray(input.body.points)) return { kind: "failed" };

  const acc = foldToBands(input.body);

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

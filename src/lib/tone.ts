/**
 * Canonical tone aggregation -- the single source every tone surface reads.
 *
 * Replaces the old per-component reductions of `sentiment7d` (header pill =
 * 8-day mean, KPI cell = 3-day mean, Signal Trend + Price & Tone = today-only),
 * which disagreed because they reduced the same array over different windows and
 * because the "today" slot defaulted to neutral until late UTC. Here there is ONE
 * score, ONE window, and the level + evidence count share that window so they
 * cannot contradict.
 *
 * Source of truth: company_mentions.sentiment (one row per article-company pair).
 * The score is never displayed raw; it drives the plain-language LEVEL only.
 *
 * Thresholds are calibrated against the live distribution (read-only recon over
 * the n>=5 and n>=10 company cohorts): the +-0.20 / +-0.60 cuts land on the real
 * quartiles (p25~0.27, p75~0.64) and hold across both cohorts. They are symmetric
 * by design -- the corpus is bullish-skewed today so the negative buckets are
 * near-empty, but a genuinely negative company must still be labelled correctly
 * when one appears, so the buckets are NOT shifted to balance today's skew.
 */

export type SentimentLabel = "bullish" | "bearish" | "neutral";

export type ToneLevel =
  | "STRONGLY_POSITIVE"
  | "POSITIVE"
  | "MIXED"
  | "NEGATIVE"
  | "STRONGLY_NEGATIVE";

export type ToneDirection = "improving" | "deteriorating" | "steady";

export type TonePolarity = "positive" | "mixed" | "negative";

export interface ToneEvidence {
  total: number;
  positive: number;
  neutral: number;
  negative: number;
}

export interface ToneSummary {
  /** True when the current window has >= LEVEL_MIN_N scored mentions. */
  sufficient: boolean;
  /** Internal -1..+1 score. null when insufficient. NEVER displayed raw. */
  score: number | null;
  level: ToneLevel | null;
  /** Plain-language label for `level`; "" when insufficient. */
  levelLabel: string;
  /**
   * Article-grain counts over the SAME window as the level. Always populated
   * (even when insufficient) so the count can always accompany a rendered level
   * -- a "Strongly Positive" off 3 articles is only honest beside "3 of 3 positive".
   */
  evidence: ToneEvidence;
  /** null when suppressed (either window lacks DIRECTION_MIN_N mentions). */
  direction: ToneDirection | null;
  /** Prior-window level for the "was X last week" baseline; null when suppressed. */
  priorLevel: ToneLevel | null;
  priorLevelLabel: string | null;
}

/** Score must exceed this (abs) for a "Strongly" level. */
const STRONG_THRESHOLD = 0.6;
/** Score must exceed this (abs) to leave "Mixed". */
const MILD_THRESHOLD = 0.2;

/** Min scored mentions in the current 7d window to show a level at all. */
export const LEVEL_MIN_N = 3;
/** Min scored mentions in EACH window to show a direction signal. */
export const DIRECTION_MIN_N = 5;
/** |delta| below this reads "steady" rather than improving/deteriorating. */
export const STEADY_EPSILON = 0.1;

const LEVEL_LABELS: Record<ToneLevel, string> = {
  STRONGLY_POSITIVE: "Strongly Positive",
  POSITIVE: "Positive",
  MIXED: "Mixed",
  NEGATIVE: "Negative",
  STRONGLY_NEGATIVE: "Strongly Negative",
};

function scoreOf(label: SentimentLabel): number {
  return label === "bullish" ? 1 : label === "bearish" ? -1 : 0;
}

function meanScore(labels: SentimentLabel[]): number {
  if (labels.length === 0) return 0;
  let sum = 0;
  for (const l of labels) sum += scoreOf(l);
  return sum / labels.length;
}

/**
 * Map an internal -1..+1 score to a level. Boundaries are inclusive toward the
 * milder bucket: exactly +0.20 reads Mixed (not Positive), exactly +0.60 reads
 * Positive (not Strongly Positive), and symmetrically on the negative side.
 */
function levelOf(score: number): ToneLevel {
  if (score > STRONG_THRESHOLD) return "STRONGLY_POSITIVE";
  if (score > MILD_THRESHOLD) return "POSITIVE";
  if (score >= -MILD_THRESHOLD) return "MIXED";
  if (score >= -STRONG_THRESHOLD) return "NEGATIVE";
  return "STRONGLY_NEGATIVE";
}

function tallyEvidence(labels: SentimentLabel[]): ToneEvidence {
  let positive = 0;
  let neutral = 0;
  let negative = 0;
  for (const l of labels) {
    if (l === "bullish") positive += 1;
    else if (l === "bearish") negative += 1;
    else neutral += 1;
  }
  return { total: labels.length, positive, neutral, negative };
}

/**
 * The one aggregation. `current` and `prior` are the scored sentiment labels of
 * the trailing 7-day and preceding 7-day windows respectively. Empty days are
 * excluded simply by not being present in the arrays.
 */
export function computeTone(
  current: SentimentLabel[],
  prior: SentimentLabel[],
): ToneSummary {
  const evidence = tallyEvidence(current);

  if (current.length < LEVEL_MIN_N) {
    return {
      sufficient: false,
      score: null,
      level: null,
      levelLabel: "",
      evidence,
      direction: null,
      priorLevel: null,
      priorLevelLabel: null,
    };
  }

  const score = meanScore(current);
  const level = levelOf(score);

  // Direction is shown only when BOTH windows clear DIRECTION_MIN_N. A direction
  // computed from thin data is worse than none, so it is suppressed, not guessed.
  let direction: ToneDirection | null = null;
  let priorLevel: ToneLevel | null = null;
  if (current.length >= DIRECTION_MIN_N && prior.length >= DIRECTION_MIN_N) {
    const priorScore = meanScore(prior);
    priorLevel = levelOf(priorScore);
    const delta = score - priorScore;
    direction =
      Math.abs(delta) < STEADY_EPSILON
        ? "steady"
        : delta > 0
          ? "improving"
          : "deteriorating";
  }

  return {
    sufficient: true,
    score,
    level,
    levelLabel: LEVEL_LABELS[level],
    evidence,
    direction,
    priorLevel,
    priorLevelLabel: priorLevel ? LEVEL_LABELS[priorLevel] : null,
  };
}

export function levelToLabel(level: ToneLevel): string {
  return LEVEL_LABELS[level];
}

/** Coarse polarity for color mapping (pill tone, headline + arrow color). */
export function levelPolarity(level: ToneLevel): TonePolarity {
  if (level === "STRONGLY_POSITIVE" || level === "POSITIVE") return "positive";
  if (level === "MIXED") return "mixed";
  return "negative";
}

/** Single source for the evidence string, e.g. "14 of 17 positive". */
export function formatEvidence(e: ToneEvidence): string {
  const unit = e.total === 1 ? "article" : "articles";
  return `${e.positive} of ${e.total} ${unit} positive`;
}

/** Single source for the direction verb word. */
export function directionVerb(d: ToneDirection): string {
  return d === "improving" ? "Improving" : d === "deteriorating" ? "Deteriorating" : "Steady";
}

/** Single source for the full direction string, e.g. "Improving · was Mixed last week". */
export function formatDirection(t: ToneSummary): string | null {
  if (!t.direction || !t.priorLevelLabel) return null;
  return `${directionVerb(t.direction)} · was ${t.priorLevelLabel} last week`;
}

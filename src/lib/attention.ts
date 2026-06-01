/**
 * Canonical attention aggregation -- sibling to computeTone (src/lib/tone.ts).
 *
 * Attention is volume RELATIVE TO THE COMPANY'S OWN BASELINE, not raw count: a
 * perennial mega-cap always has high volume, which is not "elevated". The signal
 * is whether a company is getting more or less news than usual FOR IT.
 *
 *   ratio = (mentions in last 7d / 7) / (mentions in trailing 28d / 28)
 *
 * Thresholds calibrated read-only against the live company_mentions distribution
 * (69 companies clearing the gate): the cuts land on the real quartiles (p25 0.79,
 * p75 1.79), and average raw volume is near-identical across the three buckets
 * (17.8 / 15.5 / 11.6), confirming the metric captures relative attention rather
 * than absolute size. Mega-caps with steady high volume land in Normal, not Elevated.
 */

export type AttentionLevel = "ELEVATED" | "NORMAL" | "QUIET";

export interface AttentionSummary {
  /** True when current >= MIN_CURRENT mentions AND baseline >= MIN_BASELINE. */
  sufficient: boolean;
  level: AttentionLevel | null;
  /** Plain-language label for `level`; "" when insufficient. */
  levelLabel: string;
  /** current daily rate / baseline daily rate; null when insufficient. */
  ratio: number | null;
  /** Raw mention count in the current 7-day window (always populated). */
  currentCount: number;
  /** Raw mention count in the trailing 28-day baseline window. */
  baselineCount: number;
  currentRate: number | null;
  baselineRate: number | null;
}

export const CURRENT_WINDOW_DAYS = 7;
export const BASELINE_WINDOW_DAYS = 28;

/** Min mentions in the current window to show an attention level at all. */
export const ATTENTION_MIN_CURRENT = 3;
/** Min mentions in the baseline window for the ratio to be meaningful. */
export const ATTENTION_MIN_BASELINE = 3;

/** ratio >= this reads Elevated; < QUIET_RATIO reads Quiet; else Normal. */
export const ELEVATED_RATIO = 1.75;
export const QUIET_RATIO = 0.75;

const LEVEL_LABELS: Record<AttentionLevel, string> = {
  ELEVATED: "Elevated",
  NORMAL: "Normal",
  QUIET: "Quiet",
};

function levelOf(ratio: number): AttentionLevel {
  if (ratio >= ELEVATED_RATIO) return "ELEVATED";
  if (ratio < QUIET_RATIO) return "QUIET";
  return "NORMAL";
}

/**
 * `currentCount` = mentions in the trailing 7 days; `baselineCount` = mentions in
 * the 28 days immediately preceding that window (days 8 to 35 back).
 */
export function computeAttention(currentCount: number, baselineCount: number): AttentionSummary {
  const currentRate = currentCount / CURRENT_WINDOW_DAYS;
  const baselineRate = baselineCount / BASELINE_WINDOW_DAYS;
  const sufficient =
    currentCount >= ATTENTION_MIN_CURRENT && baselineCount >= ATTENTION_MIN_BASELINE;

  if (!sufficient) {
    return {
      sufficient: false,
      level: null,
      levelLabel: "",
      ratio: null,
      currentCount,
      baselineCount,
      currentRate: null,
      baselineRate: null,
    };
  }

  const ratio = currentRate / baselineRate;
  const level = levelOf(ratio);
  return {
    sufficient: true,
    level,
    levelLabel: LEVEL_LABELS[level],
    ratio,
    currentCount,
    baselineCount,
    currentRate,
    baselineRate,
  };
}

export function attentionLevelToLabel(level: AttentionLevel): string {
  return LEVEL_LABELS[level];
}

/** Secondary context shown beside the level, e.g. "100 articles · 7d". */
export function formatAttentionVolume(a: AttentionSummary): string {
  const unit = a.currentCount === 1 ? "article" : "articles";
  return `${a.currentCount} ${unit} · 7d`;
}

/** Relative-pace phrase, e.g. "1.8x typical" or "0.6x typical"; null if insufficient. */
export function formatAttentionPace(a: AttentionSummary): string | null {
  if (!a.sufficient || a.ratio === null) return null;
  return `${a.ratio.toFixed(1)}x typical`;
}

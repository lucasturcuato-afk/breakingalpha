/**
 * Continuous in-flight thesis grading — TypeScript mirror of
 * ``backend/grading/live_score.py``. Used by the Track Record page so it
 * renders meaningful data the moment it loads, even if the
 * ``theses.live_score`` column hasn't been populated yet (or doesn't exist).
 *
 * Five components, summed and clamped to [-100, +100]:
 *
 *     Price alignment       : -50 .. +50  (signal_breakdown.price_change_pct × stance)
 *     Sentiment alignment   : -25 .. +25  (latest verdicts.weighted_sentiment_alignment × 25)
 *     Support/contradict    : -15 .. +15  (clamped log of supporting_vs_contradicting_ratio × stance)
 *     Confidence boost      : -10 ..  10  (verdict-aligned: +c×10 confirmed, -c×10 invalidated)
 *     Time decay            : -10 ..   0  (only when no terminal verdict)
 *
 * Keep the constants and signs in lock-step with the Python module — the
 * Track Record page falls back to client compute when the persisted column
 * is null, so divergence would render two different scores for the same
 * thesis.
 */

export const LIVE_SCORE_BANDS = {
  price: 50,
  sentiment: 25,
  ratio: 15,
  confidence: 10,
  timeDecay: 10,
} as const;

const PRICE_SATURATION_PCT = 10;
const HORIZON_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };
const DEFAULT_HORIZON_DAYS = 30;

const TRACKING_CONFIRMED_AT = 35;
const TRACKING_INVALIDATED_AT = -35;
const NEUTRAL_BAND = 10;

export type TerminalVerdict = "confirmed" | "invalidated" | "inconclusive" | null;

export interface LiveScoreInput {
  conviction?: string | null;
  horizon?: string | null;
  generated_at?: string | null;
  signal_breakdown?: Record<string, unknown> | null;
  outcome?: TerminalVerdict;
  // From latest thesis_verdicts row (optional — degrades gracefully).
  latest_weighted_sentiment_alignment?: number | null;
  latest_supporting_vs_contradicting_ratio?: number | null;
  latest_confidence?: number | null;
  latest_verdict?: TerminalVerdict;
  // Optional: prefer a server-persisted live_score when present.
  live_score?: number | null;
  live_verdict?: string | null;
}

export interface LiveScoreResult {
  score: number;
  verdict: string;
  terminal: TerminalVerdict;
  components: {
    price: number;
    sentiment: number;
    ratio: number;
    confidence: number;
    timeDecay: number;
  };
  ageDays: number;
  horizonDays: number;
  stance: -1 | 0 | 1;
  source: "persisted" | "computed";
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function toFloat(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

function stanceDirection(conviction: string | null | undefined): -1 | 0 | 1 {
  const s = (conviction || "").trim().toUpperCase();
  if (s === "BEARISH") return -1;
  if (s === "BULLISH" || s === "HIGH" || s === "MEDIUM") return 1;
  return 0;
}

function horizonDays(horizon: string | null | undefined): number {
  const s = (horizon || "").trim().toLowerCase();
  return HORIZON_DAYS[s] ?? DEFAULT_HORIZON_DAYS;
}

function priceComponent(priceChangePct: unknown, stance: number): number {
  if (stance === 0) return 0;
  const pct = toFloat(priceChangePct);
  if (pct === null) return 0;
  const saturated = clamp(pct / PRICE_SATURATION_PCT, -1, 1);
  return saturated * LIVE_SCORE_BANDS.price * stance;
}

function sentimentComponent(weightedSentimentAlignment: number | null | undefined): number {
  const s = toFloat(weightedSentimentAlignment);
  if (s === null) return 0;
  return clamp(s, -1, 1) * LIVE_SCORE_BANDS.sentiment;
}

function ratioComponent(
  supportingVsContradictingRatio: number | null | undefined,
  stance: number,
): number {
  if (stance === 0) return 0;
  const r = toFloat(supportingVsContradictingRatio);
  if (r === null || r <= 0) return 0;
  // log10(1) = 0, log10(10) = 1 (matches the cap in features.py).
  const normalized = clamp(Math.log10(r), 0, 1);
  return normalized * LIVE_SCORE_BANDS.ratio * stance;
}

function confidenceComponent(
  verdict: TerminalVerdict,
  confidence: number | null | undefined,
): number {
  const c = toFloat(confidence);
  if (c === null) return 0;
  const clamped = clamp(c, 0, 1);
  if (verdict === "confirmed") return clamped * LIVE_SCORE_BANDS.confidence;
  if (verdict === "invalidated") return -clamped * LIVE_SCORE_BANDS.confidence;
  return 0;
}

function timeDecayComponent(
  generatedAt: string | null | undefined,
  horizon: string | null | undefined,
  verdict: TerminalVerdict,
  now: Date,
): number {
  if (verdict === "confirmed" || verdict === "invalidated") return 0;
  if (!generatedAt) return 0;
  const gen = new Date(generatedAt);
  if (Number.isNaN(gen.getTime())) return 0;
  const ageDays = Math.max(0, (now.getTime() - gen.getTime()) / 86_400_000);
  const hd = horizonDays(horizon);
  if (hd <= 0) return 0;
  const fraction = clamp(ageDays / hd, 0, 1);
  return -fraction * LIVE_SCORE_BANDS.timeDecay;
}

export function deriveLiveVerdict(
  score: number,
  terminal: TerminalVerdict,
  ageDays: number,
  hDays: number,
): string {
  if (terminal === "confirmed") return "Confirmed";
  if (terminal === "invalidated") return "Invalidated";
  if (score >= TRACKING_CONFIRMED_AT) return "Tracking confirmed";
  if (score <= TRACKING_INVALIDATED_AT) return "Tracking invalidated";
  if (ageDays >= hDays && Math.abs(score) <= NEUTRAL_BAND) {
    return `Inconclusive after ${ageDays}d`;
  }
  return "Tracking neutral";
}

export function computeLiveScore(input: LiveScoreInput, now: Date = new Date()): LiveScoreResult {
  const stance = stanceDirection(input.conviction);
  const sb = (input.signal_breakdown || {}) as Record<string, unknown>;
  const terminal: TerminalVerdict =
    input.latest_verdict === "confirmed" || input.latest_verdict === "invalidated"
      ? input.latest_verdict
      : input.outcome === "confirmed" || input.outcome === "invalidated"
        ? input.outcome
        : null;

  const components = {
    price: priceComponent(sb.price_change_pct, stance),
    sentiment: sentimentComponent(input.latest_weighted_sentiment_alignment),
    ratio: ratioComponent(input.latest_supporting_vs_contradicting_ratio, stance),
    confidence: confidenceComponent(terminal, input.latest_confidence),
    timeDecay: timeDecayComponent(input.generated_at, input.horizon, terminal, now),
  };

  const raw =
    components.price +
    components.sentiment +
    components.ratio +
    components.confidence +
    components.timeDecay;

  // Prefer persisted live_score from the backend cron when present.
  const persisted = toFloat(input.live_score);
  const score = persisted !== null ? Math.round(clamp(persisted, -100, 100)) : Math.round(clamp(raw, -100, 100));

  let ageDays = 0;
  if (input.generated_at) {
    const gen = new Date(input.generated_at);
    if (!Number.isNaN(gen.getTime())) {
      ageDays = Math.floor((now.getTime() - gen.getTime()) / 86_400_000);
    }
  }
  const hDays = horizonDays(input.horizon);

  const verdict = input.live_verdict || deriveLiveVerdict(score, terminal, ageDays, hDays);

  return {
    score,
    verdict,
    terminal,
    components,
    ageDays,
    horizonDays: hDays,
    stance,
    source: persisted !== null ? "persisted" : "computed",
  };
}

/**
 * "Tracking confirmed" / "Tracking invalidated" / "Tracking neutral" /
 * "Inconclusive after Nd" → continuous (lighter chip + italic).
 * "Confirmed" / "Invalidated" → terminal (saturated chip).
 */
export function isTerminalVerdict(label: string): boolean {
  return label === "Confirmed" || label === "Invalidated";
}

/** Bucket a live_score into a {bg, text, border} chip palette. */
export function liveScoreChipClasses(verdict: string): string {
  if (verdict === "Confirmed") return "bg-signal-up/15 text-signal-up";
  if (verdict === "Invalidated") return "bg-signal-dn/15 text-signal-dn";
  if (verdict === "Tracking confirmed") return "bg-signal-up/8 text-signal-up italic";
  if (verdict === "Tracking invalidated") return "bg-signal-dn/8 text-signal-dn italic";
  if (verdict.startsWith("Inconclusive")) return "bg-signal-warn/10 text-signal-warn italic";
  return "bg-text-faint/10 text-text-muted italic";
}

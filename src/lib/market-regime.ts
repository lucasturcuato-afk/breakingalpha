/**
 * Deterministic market-regime classification.
 *
 * This is the single source of truth for the regime ladder that drives the
 * global mood banner (useLiveMood -> deriveBanner) and, mirrored in Python,
 * the Evening Wrap synthesis grounding (backend/market_tape.py).
 *
 * SSOT MIRROR: backend/market_tape.py replicates these thresholds verbatim.
 * If you change a constant or a branch here, change it there too, and add a
 * row to backend/tests/regime_parity_cases.json (the shared case table that
 * both the TS and Python unit tests run against).
 *
 * The thresholds were lifted unchanged from the original deriveBanner ladder
 * in src/hooks/useLiveMood.ts; do not "tune" them in passing.
 */

export type Regime = "risk-off" | "risk-on" | "neutral";

/**
 * Which branch of the ladder produced the regime. Display code (deriveBanner)
 * uses this to pick the narrative string without re-implementing the ladder.
 */
export type RegimeBranch =
  | "vix-extreme" // VIX >= 25: unconditional risk-off
  | "vix-elevated" // VIX in [20, 25): risk-off only on a VIX spike
  | "vix-calm" // VIX < 15: unconditional risk-on
  | "spx-tiebreak"; // VIX in [15, 20): SPX percent move decides

// SSOT MIRROR: backend/market_tape.py REGIME_* constants.
export const VIX_EXTREME_LEVEL = 25;
export const VIX_ELEVATED_LEVEL = 20;
export const VIX_CALM_LEVEL = 15;
export const VIX_SPIKE_PCT = 3;
export const SPX_TIEBREAK_PCT = 0.3;

export interface RegimeInputs {
  /** VIX index level (e.g. 26.4). */
  vixLevel: number;
  /** VIX percent change vs prior close (e.g. +33.9). */
  vixPctChange: number;
  /** S&P 500 percent change vs prior close (e.g. -2.64). */
  spxPctChange: number;
}

export interface RegimeResult {
  regime: Regime;
  branch: RegimeBranch;
}

export function computeRegime({
  vixLevel,
  vixPctChange,
  spxPctChange,
}: RegimeInputs): RegimeResult {
  if (vixLevel >= VIX_EXTREME_LEVEL) {
    return { regime: "risk-off", branch: "vix-extreme" };
  }
  if (vixLevel >= VIX_ELEVATED_LEVEL) {
    return {
      regime: vixPctChange > VIX_SPIKE_PCT ? "risk-off" : "neutral",
      branch: "vix-elevated",
    };
  }
  if (vixLevel < VIX_CALM_LEVEL) {
    return { regime: "risk-on", branch: "vix-calm" };
  }
  const regime: Regime =
    spxPctChange > SPX_TIEBREAK_PCT
      ? "risk-on"
      : spxPctChange < -SPX_TIEBREAK_PCT
        ? "risk-off"
        : "neutral";
  return { regime, branch: "spx-tiebreak" };
}

/**
 * Tape-gated close adjective (presentation-layer truth gate).
 *
 * WHY THIS EXISTS
 * The evening-wrap hero pill and the top mood strip both used to overclaim.
 * The hero pill word ("buoyant") is minted upstream in backend/market_tape.py
 * from a VIX/SPX regime ladder that never looks at breadth: VIX < 15 forces
 * "risk-on", whose vocabulary is {buoyant, steady, resilient}, defaulting to
 * "buoyant". So a +0.42% S&P day with the Russell down -0.49% (a NARROW drift,
 * not a broad advance) still rendered "buoyant" directly above a paragraph
 * that said small-caps lagged and there was no catalyst. The pill contradicted
 * the prose beneath it.
 *
 * This module is the honest ladder. It classifies the ACTUAL tape by BOTH
 * magnitude (S&P percent move) AND breadth (does the Russell agree with the
 * S&P direction), and returns a word the tape can actually support. It is a
 * pure function with explicit numeric thresholds so it is unit-testable and
 * can never disagree with the numbers a viewer sees in the same scorecard.
 *
 * OWNERSHIP: this is a frontend presentation gate. It does NOT re-mint the
 * synthesis word (that stays grounded in backend/market_tape.py). It only
 * REFUSES a word the tape cannot support and substitutes an honest one. When
 * the backend word is already consistent with the tape magnitude/breadth, the
 * backend word is preserved verbatim.
 */

export type ToneDirection = "up" | "down" | "flat";

/** Honest close vocabulary, quiet -> loud, per direction. */
export type CloseAdjective =
  | "quiet" // sub-threshold magnitude, no conviction either way
  | "mixed" // meaningful move but breadth disagrees with the index
  | "narrow" // index up on thin breadth (small-caps lagging / red)
  | "soft" // index down on thin breadth (large-cap-led weakness)
  | "firm" // index up, breadth confirms, but move is modest
  | "heavy" // index down, breadth confirms, modest-to-material
  | "broad-based" // index up, breadth confirms, material move
  | "buoyant"; // index up, breadth confirms, strong move

export interface TapeInputs {
  /** S&P 500 percent change vs prior close (e.g. +0.42, -1.30). */
  spxPct: number | null | undefined;
  /** Russell 2000 percent change vs prior close. Breadth proxy. */
  russellPct: number | null | undefined;
}

// ── Explicit thresholds (percent points on the day) ─────────────────────────
// FLAT_BAND: |S&P| below this is a non-move -> "quiet", breadth irrelevant.
export const FLAT_BAND_PCT = 0.25;
// FIRM_BAND: |S&P| at/above FLAT and below this is a modest, real move.
export const MODEST_BAND_PCT = 0.75;
// STRONG_BAND: |S&P| at/above this is a strong, conviction move.
export const STRONG_BAND_PCT = 1.5;
// BREADTH_CONFIRM_PCT: the Russell must move at least this far IN THE SAME
// direction as the S&P for breadth to "confirm". A Russell that is flat or
// opposed does NOT confirm, so the up-move is "narrow", not broad.
export const BREADTH_CONFIRM_PCT = 0.1;

function direction(pct: number, band: number): ToneDirection {
  if (pct >= band) return "up";
  if (pct <= -band) return "down";
  return "flat";
}

export interface TapeVerdict {
  adjective: CloseAdjective;
  direction: ToneDirection;
  /** True when the Russell confirms the S&P direction beyond the noise band. */
  breadthConfirms: boolean;
  /** True when |S&P| is below the flat band (a non-move). */
  quiet: boolean;
}

/**
 * Classify the tape into an honest close verdict. Pure. Null/NaN inputs
 * degrade gracefully: a missing S&P returns a "quiet"/flat verdict (we never
 * assert direction we cannot see), a missing Russell is treated as breadth
 * that does NOT confirm (we do not upgrade to broad-based on faith).
 */
export function classifyTape({ spxPct, russellPct }: TapeInputs): TapeVerdict {
  const spx =
    typeof spxPct === "number" && Number.isFinite(spxPct) ? spxPct : null;
  const rut =
    typeof russellPct === "number" && Number.isFinite(russellPct)
      ? russellPct
      : null;

  if (spx === null) {
    return { adjective: "quiet", direction: "flat", breadthConfirms: false, quiet: true };
  }

  const dir = direction(spx, FLAT_BAND_PCT);
  if (dir === "flat") {
    return { adjective: "quiet", direction: "flat", breadthConfirms: false, quiet: true };
  }

  const mag = Math.abs(spx);
  // Breadth confirms only when the Russell moves the SAME way beyond the noise
  // band. A null Russell, a flat Russell, or an opposed Russell = no confirm.
  const rutDir = rut === null ? "flat" : direction(rut, BREADTH_CONFIRM_PCT);
  const breadthConfirms = rutDir === dir;

  let adjective: CloseAdjective;
  if (dir === "up") {
    if (!breadthConfirms) {
      // Index green but small-caps flat/red: a narrow drift. This is the
      // Jul 10 case (+0.42% S&P, -0.49% Russell) that used to say "buoyant".
      adjective = mag >= STRONG_BAND_PCT ? "mixed" : "narrow";
    } else if (mag >= STRONG_BAND_PCT) {
      adjective = "buoyant";
    } else if (mag >= MODEST_BAND_PCT) {
      adjective = "broad-based";
    } else {
      adjective = "firm";
    }
  } else {
    // dir === "down"
    if (!breadthConfirms) {
      adjective = mag >= STRONG_BAND_PCT ? "mixed" : "soft";
    } else {
      adjective = "heavy";
    }
  }

  return { adjective, direction: dir, breadthConfirms, quiet: false };
}

// Words the backend may emit that assert a BROAD, strong advance. If the tape
// does not support a broad advance (narrow/mixed/quiet/down), these overclaim
// and must be replaced by the tape-honest word. Kept in sync with the
// "risk-on" vocabulary in backend/market_tape.py (REGIME_VOCAB).
const OVERCLAIM_UP_WORDS = new Set(["buoyant", "resilient", "broad-based", "rallying"]);
// Words that assert broad weakness; if the tape is not a confirmed down day
// they overclaim in the bearish direction.
const OVERCLAIM_DOWN_WORDS = new Set(["heavy", "fragile", "capitulation", "routed"]);

/**
 * Reconcile a backend-minted close word against the actual tape. Returns the
 * word to DISPLAY.
 *
 * Contract: preserve the backend word when it does not overclaim relative to
 * the tape. Only substitute when the backend word asserts more conviction or
 * breadth than the numbers support (e.g. "buoyant" on a narrow up-drift, or
 * "heavy" on a large-cap-led dip the Russell did not confirm). This keeps the
 * grounded synthesis voice intact on honest days and gates it on the days it
 * would contradict the prose and scorecard beneath it.
 */
export function reconcileCloseWord(
  backendWord: string | null | undefined,
  tape: TapeInputs,
): string | null {
  const verdict = classifyTape(tape);
  const raw = (backendWord ?? "").trim();
  if (!raw) {
    // No backend word: fall back to the tape-honest word only when we have a
    // real move to describe. On a quiet/flat unknown tape, assert nothing.
    return verdict.quiet && (tape.spxPct == null) ? null : verdict.adjective;
  }

  const lower = raw.toLowerCase();
  // A word may assert a BROAD advance only when breadth confirms AND the move
  // is at least material ("broad-based") or strong ("buoyant"). A modest,
  // breadth-confirmed drift is honest as "firm", not "buoyant": a sub-0.75%
  // S&P move is not buoyant even with a green Russell.
  const tapeSupportsBroadUp =
    verdict.direction === "up" &&
    verdict.breadthConfirms &&
    (verdict.adjective === "buoyant" || verdict.adjective === "broad-based");
  const tapeSupportsBroadDown =
    verdict.direction === "down" && verdict.breadthConfirms;

  if (OVERCLAIM_UP_WORDS.has(lower) && !tapeSupportsBroadUp) {
    return verdict.adjective;
  }
  if (OVERCLAIM_DOWN_WORDS.has(lower) && !tapeSupportsBroadDown) {
    return verdict.adjective;
  }
  // Backend word is consistent with the tape (or is a neutral word like
  // "steady"/"mixed"/"choppy" that never overclaims): keep the grounded voice.
  return raw;
}

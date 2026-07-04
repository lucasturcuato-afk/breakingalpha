/**
 * scored-object-map — pure mappers from real rows to ScoredObject props.
 *
 * NO FAKE DATA, structurally enforced: a resolved state (right / wrong /
 * inconclusive) is only ever emitted by scoredCallProps when a REAL
 * morning_brief_call_outcomes row is passed in. With no outcome row a call
 * renders Open (window still live) or notGraded (window closed, honest
 * absence) — never a verdict. Every rendered value comes straight from real
 * data; a missing field is omitted (never invented).
 *
 * Verdict/attribution -> state mapping (attribution wins over raw direction):
 *   attribution confounded    -> inconclusive "No clean read" (beta, no credit)
 *   attribution inconclusive  -> inconclusive "No clean read" (below the bar)
 *   correct + clean           -> right
 *   wrong   + clean           -> wrong
 *   partial + clean           -> inconclusive (graded, but no attributable hit)
 *   verdict ungradable        -> notGraded (an absence, NOT a verdict)
 *   legacy row (null attribution, pre-attribution grader) -> notGraded
 *
 * The call's stored confidence and the grader's attribution_confidence are
 * both deliberately NOT rendered (see OpenCallInput.confidence).
 */

import type { ScoredObjectProps } from "@/components/scored-object/ScoredObject";

/** Short "Apr 8" style date; returns undefined for missing/invalid input. */
export function shortDate(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** 0-1 confidence -> integer percent; undefined if not a real number. */
function toPct(confidence: number | null | undefined): number | undefined {
  if (confidence == null || Number.isNaN(confidence)) return undefined;
  // Stored 0-1; guard against an already-percent value just in case.
  const pct = confidence <= 1 ? confidence * 100 : confidence;
  return Math.round(pct);
}

export interface OpenThesisInput {
  /** Already-neutralized title/claim (caller applies neutralizeThesisTitle). */
  claim: string;
  sector?: string | null;
  generated_at?: string | null;
  check_after?: string | null;
  horizon?: string | null;
  confidence?: number | null;
}

/** Map an OPEN thesis (no terminal outcome) to ScoredObject open props. */
export function openThesisProps(t: OpenThesisInput): ScoredObjectProps {
  return {
    state: "open",
    sector: (t.sector && t.sector.trim()) || "Thesis",
    claim: t.claim,
    calledDate: shortDate(t.generated_at),
    confidencePct: toPct(t.confidence),
    resolvesWhen: shortDate(t.check_after),
    resolvesSource: t.horizon ? `the ${t.horizon} signal check` : undefined,
  };
}

export interface OpenCallInput {
  claim_text: string;
  target_symbol?: string | null;
  claim_type?: string | null;
  /**
   * Present on the row but intentionally NEVER rendered: it is an
   * unguided LLM self-report, not a validated probability. The grader's
   * attribution_confidence (outcome metadata) is the only trustworthy
   * confidence. Kept in the data for future calibration work.
   */
  confidence?: number | null;
  created_at?: string | null;
  brief_date?: string | null;
}

/** Human label for a claim_type when it would otherwise render its raw enum
 *  in the ticker slot (display only; never affects grading). */
const CLAIM_TYPE_EYEBROW: Record<string, string> = {
  sector: "Sector",
  index: "Index",
  ticker: "Call",
};

/**
 * Eyebrow/ticker-slot label for a call. A named ticker/sector/index symbol
 * is shown as-is; aggregate (macro) claims are market-wide and always show
 * "Macro" rather than any single-name proxy symbol the grader won't credit;
 * anything else falls back to a humanized claim_type, never a raw enum.
 */
function callEyebrow(c: OpenCallInput): string {
  const claimType = (c.claim_type ?? "").trim().toLowerCase();
  if (claimType === "aggregate") return "Macro";
  const symbol = c.target_symbol?.trim();
  if (symbol) return symbol;
  return CLAIM_TYPE_EYEBROW[claimType] ?? "Call";
}

/**
 * Map a real morning_brief_calls row to ScoredObject open props. These are the
 * brief's predictive claims; grading is not live, so they only ever render open.
 */
export function openCallProps(c: OpenCallInput): ScoredObjectProps {
  const eyebrow = callEyebrow(c);
  return {
    state: "open",
    sector: eyebrow,
    claim: c.claim_text,
    calledDate: shortDate(c.created_at ?? c.brief_date),
    // confidencePct is deliberately omitted: see OpenCallInput.confidence.
    // Grading basis is the market close; the resolve DATE is not a stored
    // field, so it is left to the component's neutral fallback rather than
    // invented.
    resolvesSource: "the market close",
  };
}

// ── Live outcome mapping (attribution grader output -> resolved states) ──

/** One benchmark entry inside outcome metadata, as written by
 *  backend/grading/price_attribution.py. All *_pct are percent points. */
export interface CallOutcomeBenchmark {
  symbol: string;
  role: "sector" | "market" | string;
  move_pct: number;
  excess_pct: number;
  meaningful_bar_pct: number;
}

/** metadata jsonb written by the grader. Gradable rows carry the price
 *  evidence; ungradable rows carry ungradable_reason/detail instead. */
export interface CallOutcomeMetadata {
  grader?: string;
  entity_symbol?: string;
  tier?: string;
  thresholds_pct?: { dead_band?: number; min_excess?: number };
  entity_move_pct?: number;
  benchmarks?: CallOutcomeBenchmark[];
  benchmark_coverage?: string;
  attribution_confidence?: number;
  window?: { from?: string; to?: string };
  ungradable_reason?: string;
  ungradable_detail?: string;
}

/** A morning_brief_call_outcomes row as read by the frontend. */
export interface CallOutcomeRow {
  call_id: string;
  verdict: "correct" | "wrong" | "partial" | "ungradable" | string;
  attribution: "clean" | "confounded" | "inconclusive" | null;
  actual_pct_change: number | null;
  actual_direction: string | null;
  verdict_notes: string | null;
  graded_at: string | null;
  metadata: CallOutcomeMetadata | null;
}

/** Human labels for the grader's honest refusal reasons. */
const UNGRADABLE_LABELS: Record<string, string> = {
  unmapped_symbol: "Couldn't map this claim to a symbol.",
  no_price_data: "No price data for the session.",
  no_benchmark_data: "Benchmark data unavailable.",
  no_honest_grader: "No honest grader for this claim type yet.",
};

function fmtSignedPct(pctPoints: number): string {
  return `${pctPoints >= 0 ? "+" : ""}${pctPoints.toFixed(2)}%`;
}

/** "Attribution: clean — NVDA +2.31% vs XLK +0.42%, SPY +0.15%." */
function cleanAttributionLine(meta: CallOutcomeMetadata | null): string {
  const sym = meta?.entity_symbol;
  const move = meta?.entity_move_pct;
  if (!sym || move == null) return "Attribution: clean.";
  const benches = (meta?.benchmarks ?? [])
    .map((b) => `${b.symbol} ${fmtSignedPct(b.move_pct)}`)
    .join(", ");
  return benches
    ? `Attribution: clean — ${sym} ${fmtSignedPct(move)} vs ${benches}.`
    : `Attribution: clean — ${sym} moved ${fmtSignedPct(move)} outright.`;
}

/** "Moved with the market (SPY +1.02%) — can't credit the thesis." */
function confoundedAttributionLine(meta: CallOutcomeMetadata | null): string {
  const move = meta?.entity_move_pct;
  const benchmarks = meta?.benchmarks ?? [];
  if (move != null && benchmarks.length > 0) {
    const sign = move >= 0 ? 1 : -1;
    const carriers = benchmarks.filter(
      (b) => b.move_pct * sign >= b.meaningful_bar_pct,
    );
    if (carriers.length > 0) {
      const roles = new Set(carriers.map((b) => b.role));
      const phrase =
        roles.has("sector") && roles.has("market")
          ? "its sector and the market"
          : roles.has("sector")
            ? "its sector"
            : "the market";
      const detail = carriers
        .map((b) => `${b.symbol} ${fmtSignedPct(b.move_pct)}`)
        .join(", ");
      return `Moved with ${phrase} (${detail}) — can't credit the thesis.`;
    }
  }
  return "Moved with its benchmark — can't credit the thesis.";
}

/** "NVDA +0.40% — below the ±0.75% attribution bar." */
function inconclusiveAttributionLine(meta: CallOutcomeMetadata | null): string {
  const sym = meta?.entity_symbol;
  const move = meta?.entity_move_pct;
  const bar = meta?.thresholds_pct?.min_excess;
  if (sym && move != null && bar != null) {
    return `${sym} ${fmtSignedPct(move)} — below the ±${bar}% attribution bar.`;
  }
  return "Below the attribution threshold.";
}

/**
 * Map a real call plus its (possibly absent) real outcome row to ScoredObject
 * props. `todayPtDate` is today's US-Pacific session date (YYYY-MM-DD), used
 * only to distinguish a still-live Open window from a closed-but-never-graded
 * one; it never influences a verdict.
 */
export function scoredCallProps(
  c: OpenCallInput,
  outcome: CallOutcomeRow | null,
  todayPtDate: string,
): ScoredObjectProps {
  const open = openCallProps(c);

  if (!outcome) {
    // No outcome row. Open only while the window is genuinely live;
    // afterwards, an honest "not graded", never an eternal pending.
    if (c.brief_date && c.brief_date < todayPtDate) {
      return {
        ...open,
        state: "notGraded",
        resolvesSource: undefined,
        notGradedReason: "Window closed without a grade.",
      };
    }
    return open;
  }

  const meta = outcome.metadata;

  if (outcome.verdict === "ungradable") {
    const reason = meta?.ungradable_reason;
    return {
      ...open,
      state: "notGraded",
      resolvesSource: undefined,
      notGradedReason:
        (reason && UNGRADABLE_LABELS[reason]) ??
        outcome.verdict_notes ??
        "Not graded.",
    };
  }

  if (outcome.attribution == null) {
    // Legacy row from the pre-attribution grader: a directional grade with
    // no benchmark evidence. Not shown as a verdict (live-forward only).
    return {
      ...open,
      state: "notGraded",
      resolvesSource: undefined,
      notGradedReason: "Scored by the pre-attribution grader; verdict not shown.",
    };
  }

  const resolved: ScoredObjectProps = {
    ...open,
    resolvesWhen: undefined,
    resolvesSource: undefined,
    scoredDate: shortDate(outcome.graded_at),
    calibration: outcome.verdict_notes ?? undefined,
    state: "inconclusive",
  };

  // Attribution wins over raw direction: a move the grader could not credit
  // to the thesis is "No clean read" whatever direction prices went.
  if (outcome.attribution === "confounded") {
    return { ...resolved, attribution: confoundedAttributionLine(meta) };
  }
  if (outcome.attribution === "inconclusive") {
    return { ...resolved, attribution: inconclusiveAttributionLine(meta) };
  }

  // attribution === "clean"
  if (outcome.verdict === "correct") {
    return { ...resolved, state: "right", attribution: cleanAttributionLine(meta) };
  }
  if (outcome.verdict === "wrong") {
    return { ...resolved, state: "wrong", attribution: cleanAttributionLine(meta) };
  }
  // partial + clean: graded, decoupled from benchmarks, but no directional hit.
  return { ...resolved, attribution: cleanAttributionLine(meta) };
}

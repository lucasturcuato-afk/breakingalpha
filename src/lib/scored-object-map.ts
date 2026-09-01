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
import { NOT_GRADED_PENDING_REASON } from "./verdict-vocabulary.ts";

/** Short "Apr 8" style date; returns undefined for missing/invalid input. */
export function shortDate(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// toPct removed with the last confidencePct producer: no mapper renders a
// confidence percentage any more, so the converter had no callers left.

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
    // confidencePct deliberately omitted, matching openCallProps. A percentage
    // reads as a probability of being right; it is a model self-report, it is
    // never a grading input, and this product does not show one. The value is
    // still accepted on the input type so callers need no change.
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

/** One fixed-fraction interim read, written by the long-horizon panel in
 *  backend/grading/price_attribution.py. Pure price math, no LLM. */
export interface CallCheckpoint {
  fraction: number;
  date: string;
  sessions: number;
  entity_pct: number;
  /** Excess vs the weakest benchmark, signed into the credited direction. */
  signed_excess_pct: number;
  bar_pct: number;
  /** The call was materially behind its benchmarks here. */
  disagrees: boolean;
}

/** How strong the attribution claim is. Descriptive: no verdict reads it.
 *  "high" = short window; "moderate" = long window with agreeing checkpoints;
 *  "directional" = long window with no usable interim evidence. */
export type AttributionGrade = "high" | "moderate" | "directional" | "none";

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
  /** Present only on long-horizon grades (>= 10 sessions). Absent entirely on
   *  short calls, whose rows are unchanged by the panel. */
  horizon_class?: "long";
  attribution_grade?: AttributionGrade;
  checkpoints?: CallCheckpoint[];
  panel?: {
    agreed: boolean;
    downgraded: boolean;
    pre_panel_verdict: string;
    pre_panel_attribution: string;
  };
  window_sessions?: number;
  threshold_scale?: number;
}

/**
 * The honest confidence label for a graded call.
 *
 * A quarter-long call and a same-session call can both clear the attribution
 * bar, but they do not support the same causal claim: a quarter accumulates
 * earnings, guidance and rotation between entry and exit. This states that
 * difference instead of letting both render with identical authority.
 *
 * Returns null when there is nothing to say (short call, or nothing cleanly
 * attributed), so the label never becomes decoration.
 */
export function attributionGradeLabel(
  meta: CallOutcomeMetadata | null,
): string | null {
  const grade = meta?.attribution_grade;
  if (!grade || grade === "none") return null;
  const sessions = meta?.window_sessions;
  const over = sessions ? ` over ${sessions} sessions` : "";
  if (grade === "high") return null; // short calls say nothing extra
  if (grade === "moderate") {
    return `Directional read${over}: benchmark-relative at every checkpoint.`;
  }
  return `Directional read${over}: no interim benchmark evidence available.`;
}

/**
 * The one-line explanation of a panel downgrade, or null.
 *
 * A downgrade is never silent: the reader is told the terminal numbers cleared
 * the bar and why that was not enough.
 */
export function panelDowngradeNote(
  meta: CallOutcomeMetadata | null,
): string | null {
  if (!meta?.panel?.downgraded) return null;
  const behind = (meta.checkpoints ?? []).filter((c) => c.disagrees);
  if (behind.length === 0) return null;
  const dates = behind.map((c) => c.date).join(" and ");
  return `Cleared the bar at the close, but trailed its benchmarks at ${dates}. Counted as no clean read, not a win.`;
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
      /* PENDING, NOT TERMINAL, and the sentence used to say the opposite.
         "Window closed without a grade." reads as a window that closed and
         produced nothing. What is true on this branch is that the window
         closed and the grader has not run against it: the call is gradeable,
         it has no outcome row, and it satisfies every condition the grader
         scans for. The sentence is now `verdict-vocabulary.ts`'s, so the desk
         card, the record and both mobile sections say it once. */
      return {
        ...open,
        state: "notGraded",
        resolvesSource: undefined,
        notGradedReason: NOT_GRADED_PENDING_REASON,
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

  // A long-horizon grade appends its honest confidence label, and a panel
  // downgrade states plainly what happened.
  //
  // A panel downgrade REPLACES the generic attribution line rather than
  // appending to it. The generic inconclusive line says "below the attribution
  // bar", which is false for a downgraded call: AMD cleared the 5.95% bar by
  // 40 points and was downgraded for trailing at its checkpoints. Appending
  // would have published a sentence contradicted by its own numbers.
  const downgradeNote = panelDowngradeNote(meta);
  const gradeLabel = attributionGradeLabel(meta);
  const withHorizon = (line: string) => {
    const base = downgradeNote ?? line;
    return gradeLabel ? `${base} ${gradeLabel}` : base;
  };

  // Attribution wins over raw direction: a move the grader could not credit
  // to the thesis is "No clean read" whatever direction prices went.
  if (outcome.attribution === "confounded") {
    return { ...resolved, attribution: withHorizon(confoundedAttributionLine(meta)) };
  }
  if (outcome.attribution === "inconclusive") {
    return { ...resolved, attribution: withHorizon(inconclusiveAttributionLine(meta)) };
  }

  // attribution === "clean"
  if (outcome.verdict === "correct") {
    return { ...resolved, state: "right", attribution: withHorizon(cleanAttributionLine(meta)) };
  }
  if (outcome.verdict === "wrong") {
    return { ...resolved, state: "wrong", attribution: withHorizon(cleanAttributionLine(meta)) };
  }
  // partial + clean: graded, decoupled from benchmarks, but no directional hit.
  return { ...resolved, attribution: withHorizon(cleanAttributionLine(meta)) };
}

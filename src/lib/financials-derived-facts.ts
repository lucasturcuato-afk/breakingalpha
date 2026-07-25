/**
 * financials-derived-facts.ts -- deterministic multi-period arithmetic over a
 * company's own XBRL grid.
 *
 * WHY THIS EXISTS. The commentary generator used to receive a raw period table
 * and was left to derive multi-period trends itself. It approximated instead of
 * counting, and shipped false streaks against the very table in its prompt:
 * gemini-2.5-flash wrote "operating cash flow decreased for the third
 * consecutive year" for Caterpillar (the real run is two, FY2023 broke it) and
 * "the second consecutive annual decrease" for Otter Tail operating income (the
 * real run is one, FY2024 was an increase). Both sentences are descriptive and
 * compliant, so compliance-language-filter.ts correctly let them through. The
 * failure is arithmetic, not tone.
 *
 * The rule this module enforces: deterministic arithmetic is never delegated to
 * the model. Runs, extremes, deltas and sign crossings are computed here, in
 * code, from the periods already assembled, and handed to the generator as a
 * closed list of permitted multi-period claims. What is not in the list is not
 * true of this data, and multi-period-claim-validator.ts strips anything the
 * model states outside it.
 *
 * Margins (gross, operating, net) are computed here too, so a margin-trend
 * sentence has a verifiable basis rather than being an unverifiable inference
 * off two raw rows.
 *
 * Pure and dependency-free: no network, no model, no DB. Unit-testable.
 */

import type { CompanyFinancialsResult, FinancialView } from "@/lib/financial-facts";

/** Which serialized view a fact was computed over. */
export type DerivedView = "annual" | "quarterly";

export type DerivedFactKind =
  | "run_increase"
  | "run_decrease"
  | "extreme_high"
  | "extreme_low"
  | "first_positive"
  | "first_negative"
  | "delta";

export interface DerivedFact {
  kind: DerivedFactKind;
  view: DerivedView;
  /** Grid metric key, or a computed key such as "operating_margin". */
  metricKey: string;
  /** Human label as it appears in the prompt. */
  metricLabel: string;
  /**
   * Consecutive period-over-period moves in the run. run_increase /
   * run_decrease only; 0 elsewhere. A run of 2 means the two most recent
   * transitions moved the same way, i.e. "the second consecutive" is true and
   * "the third" is not.
   */
  runLength: number;
  /** Periods with a usable value in this view, oldest..newest inclusive. */
  periodsCovered: number;
  /** Oldest period the fact reaches back to (a run's starting period). */
  startLabel: string;
  /** Newest period label. */
  endLabel: string;
  /** Newest value. */
  latest: number;
  /** Prior period value where one exists. */
  previous: number | null;
  /** Rendered line for the DERIVED FACTS prompt block. */
  statement: string;
}

/** Raw grid rows fed to the generator, in prompt order. */
const BASE_METRICS: Array<{ key: string; label: string; percent?: boolean }> = [
  { key: "revenue", label: "Revenue" },
  { key: "cost_of_revenue", label: "Cost of revenue" },
  { key: "gross_profit", label: "Gross profit" },
  { key: "operating_income", label: "Operating income" },
  { key: "net_income", label: "Net income" },
  { key: "eps_diluted", label: "EPS (diluted)" },
  { key: "eps_basic", label: "EPS (basic)" },
  { key: "shares_diluted", label: "Diluted shares" },
  { key: "operating_cash_flow", label: "Operating cash flow" },
  { key: "total_assets", label: "Total assets" },
  { key: "total_liabilities", label: "Total liabilities" },
  { key: "stockholders_equity", label: "Stockholders' equity" },
  { key: "cash_and_equivalents", label: "Cash & equivalents" },
];

/** Ratios the grid does not carry but the model reaches for anyway. */
const RATIO_METRICS: Array<{ key: string; label: string; num: string; den: string }> = [
  { key: "gross_margin", label: "Gross margin", num: "gross_profit", den: "revenue" },
  { key: "operating_margin", label: "Operating margin", num: "operating_income", den: "revenue" },
  { key: "net_margin", label: "Net margin", num: "net_income", den: "revenue" },
];

/** A metric's values in prompt order (newest first); null where unreported. */
interface Series {
  key: string;
  label: string;
  percent: boolean;
  points: Array<{ label: string; value: number | null }>;
}

/** Minimum consecutive moves before a run is a claimable streak. */
const MIN_RUN = 2;
/** Minimum periods before "highest/lowest of the periods shown" means anything. */
const MIN_EXTREME_PERIODS = 3;

function fmt(v: number, percent: boolean): string {
  if (!Number.isFinite(v)) return "n/a";
  if (percent) return `${v.toFixed(2)}%`;
  if (Math.abs(v) >= 1000 && Number.isInteger(v)) return v.toLocaleString("en-US");
  return String(Number(v.toFixed(4)));
}

function pct(latest: number, previous: number): string | null {
  if (previous === 0 || !Number.isFinite(previous) || !Number.isFinite(latest)) return null;
  const change = ((latest - previous) / Math.abs(previous)) * 100;
  return `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
}

/** Period-over-period label for a view. */
function stepWord(view: DerivedView): string {
  return view === "annual" ? "fiscal year" : "fiscal quarter";
}

function cellValue(view: FinancialView, metricKey: string, periodKey: string): number | null {
  const v = view.grid[metricKey]?.[periodKey]?.value;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Build every series (raw rows plus computed ratios) for one view. */
function buildSeries(view: FinancialView): Series[] {
  const out: Series[] = [];

  for (const { key, label } of BASE_METRICS) {
    if (!view.grid[key]) continue;
    const points = view.periods.map((p) => ({ label: p.label, value: cellValue(view, key, p.key) }));
    if (points.some((pt) => pt.value !== null)) {
      out.push({ key, label, percent: false, points });
    }
  }

  for (const { key, label, num, den } of RATIO_METRICS) {
    if (!view.grid[num] || !view.grid[den]) continue;
    const points = view.periods.map((p) => {
      const n = cellValue(view, num, p.key);
      const d = cellValue(view, den, p.key);
      // A margin off a zero or negative revenue base is not interpretable.
      if (n === null || d === null || d <= 0) return { label: p.label, value: null };
      return { label: p.label, value: (n / d) * 100 };
    });
    if (points.some((pt) => pt.value !== null)) {
      out.push({ key, label, percent: true, points });
    }
  }

  return out;
}

/**
 * Consecutive same-direction moves ending at the newest period. Counting stops
 * at the first move that breaks direction AND at the first missing value, so a
 * gap can never be counted through. This is the function the model was getting
 * wrong.
 */
function runLength(points: Series["points"], direction: "up" | "down"): number {
  let n = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const cur = points[i].value;
    const prev = points[i + 1].value;
    if (cur === null || prev === null) break;
    const moved = direction === "up" ? cur > prev : cur < prev;
    if (!moved) break;
    n++;
  }
  return n;
}

function factsForSeries(s: Series, view: DerivedView): DerivedFact[] {
  const facts: DerivedFact[] = [];
  const present = s.points.filter((p) => p.value !== null) as Array<{ label: string; value: number }>;
  if (present.length === 0) return facts;

  const newest = s.points[0];
  if (newest.value === null) return facts; // Nothing to anchor a claim to.

  const latest = newest.value;
  const previous = s.points[1]?.value ?? null;
  const base = {
    view,
    metricKey: s.key,
    metricLabel: s.label,
    runLength: 0,
    periodsCovered: present.length,
    startLabel: present[present.length - 1].label,
    endLabel: newest.label,
    latest,
    previous,
  };

  // Sequential delta. Not a multi-period claim, but it stops the model from
  // computing its own percentages badly.
  if (previous !== null) {
    const change = latest - previous;
    const p = pct(latest, previous);
    // A margin move is percentage POINTS; labelling it "%" alongside a relative
    // percent change is exactly the ambiguity that invites a bad sentence.
    const delta = s.percent
      ? `${change >= 0 ? "+" : ""}${change.toFixed(2)} percentage points${p ? ` (relative ${p})` : ""}`
      : `${change >= 0 ? "+" : ""}${fmt(change, false)}${p ? ` (${p})` : ""}`;
    facts.push({
      ...base,
      kind: "delta",
      startLabel: s.points[1].label,
      statement:
        `${s.label}: ${newest.label} ${fmt(latest, s.percent)} vs ${s.points[1].label} ` +
        `${fmt(previous, s.percent)}, change ${delta}.`,
    });
  }

  // Runs. Only one direction can be non-zero.
  for (const direction of ["up", "down"] as const) {
    const n = runLength(s.points, direction);
    if (n < MIN_RUN) continue;
    const startLabel = s.points[n].label;
    const word = direction === "up" ? "increased" : "decreased";
    facts.push({
      ...base,
      kind: direction === "up" ? "run_increase" : "run_decrease",
      runLength: n,
      startLabel,
      statement:
        `${s.label}: ${word} in ${n} consecutive ${stepWord(view)}${n === 1 ? "" : "s"}, ` +
        `${startLabel} through ${newest.label}. The run is exactly ${n}; it does not extend further back.`,
    });
  }

  // Extremes, anchored at the newest period only.
  if (present.length >= MIN_EXTREME_PERIODS) {
    const values = present.map((p) => p.value);
    const max = Math.max(...values);
    const min = Math.min(...values);
    if (latest === max && values.filter((v) => v === max).length === 1) {
      facts.push({
        ...base,
        kind: "extreme_high",
        statement: `${s.label}: ${newest.label} ${fmt(latest, s.percent)} is the highest of the ${present.length} ${stepWord(view)}s shown.`,
      });
    }
    if (latest === min && values.filter((v) => v === min).length === 1) {
      facts.push({
        ...base,
        kind: "extreme_low",
        statement: `${s.label}: ${newest.label} ${fmt(latest, s.percent)} is the lowest of the ${present.length} ${stepWord(view)}s shown.`,
      });
    }
  }

  // Sign crossings: true only when every earlier period sits on the other side.
  const earlier = present.slice(1);
  if (earlier.length > 0) {
    if (latest > 0 && earlier.every((p) => p.value <= 0)) {
      facts.push({
        ...base,
        kind: "first_positive",
        statement: `${s.label}: ${newest.label} is the first positive value in the ${present.length} ${stepWord(view)}s shown.`,
      });
    }
    if (latest < 0 && earlier.every((p) => p.value >= 0)) {
      facts.push({
        ...base,
        kind: "first_negative",
        statement: `${s.label}: ${newest.label} is the first negative value in the ${present.length} ${stepWord(view)}s shown.`,
      });
    }
  }

  return facts;
}

/**
 * Every verified multi-period fact for a company, annual then quarterly. This
 * is the closed set: a multi-period claim not derivable from this list is not
 * supported by the data.
 */
export function computeDerivedFacts(financials: CompanyFinancialsResult): DerivedFact[] {
  const facts: DerivedFact[] = [];
  for (const [view, source] of [
    ["annual", financials.annual],
    ["quarterly", financials.quarterly],
  ] as Array<[DerivedView, FinancialView]>) {
    if (!source || source.periods.length === 0) continue;
    for (const s of buildSeries(source)) {
      facts.push(...factsForSeries(s, view));
    }
  }
  return facts;
}

/**
 * Render the DERIVED FACTS prompt block. Returns "" when nothing was derivable
 * (a single-period table yields no facts), in which case the caller omits the
 * section and the model is told no multi-period claim is available.
 */
export function formatDerivedFactsBlock(facts: DerivedFact[]): string {
  if (facts.length === 0) return "";

  const lines: string[] = [];
  for (const view of ["annual", "quarterly"] as DerivedView[]) {
    const forView = facts.filter((f) => f.view === view);
    if (forView.length === 0) continue;
    lines.push(view === "annual" ? "ANNUAL:" : "QUARTERLY:");
    for (const f of forView) lines.push(`- ${f.statement}`);
  }
  return lines.join("\n");
}

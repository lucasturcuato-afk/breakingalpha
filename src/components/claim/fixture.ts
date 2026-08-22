import { MAX_WINDOW_DAYS } from "@/lib/call-horizons";

/**
 * Sample content for the Claim screen, taken verbatim from the rendered
 * prototype, in the shape of `src/components/ledger/fixture.ts`.
 *
 * This screen has no data source yet and this unit does not wire one. The
 * shape below IS the contract a real loader has to satisfy, and writing it
 * out is the point: three of its fields have no column behind them today and
 * the type is where that shows up rather than being discovered at fetch time.
 *
 * WHERE EACH FIELD WOULD COME FROM, and where it would not:
 *
 *   id, eyebrow, claim   `morning_brief_calls`. The row carries `id`,
 *                        `claim_text`, `target_symbol`, `claim_type`,
 *                        `brief_date` and `resolve_on`
 *                        (BriefCallsSection.tsx:212), and the sector eyebrow
 *                        resolves through `companies.sector` by ticker
 *                        (`:319`), which is the same join that surface makes.
 *   settlement.window    `call-horizons.ts`. MAX_WINDOW_DAYS is the clamp and
 *                        HORIZON_DAYS.quarter lands exactly on it, which is
 *                        where the design's 90 comes from.
 *   settlement.checked   `resolve_on` on the same row.
 *
 *   reading              NO SOURCE. `morning_brief_calls` stores the claim
 *                        sentence and nothing behind it. The two paragraphs of
 *                        desk reasoning the design draws have no column.
 *   settles              NO SOURCE. The same gap: there is no stored statement
 *                        of what would falsify the claim.
 *   settlement.benchmarks
 *                        NO SOURCE at read time. Benchmark selection happens
 *                        inside `backend/grading/price_attribution.py` when
 *                        the grader runs, and nothing surfaces the pair to the
 *                        frontend before that. Recorded as batch-2 open
 *                        question 8, not invented around.
 *
 * Compliance note on sample content: the rule against an aggregate figure
 * reaches sample data. Nothing here is a rate. `position` is a count of where
 * this claim sits in today's brief, and the window is a span in days.
 */

export interface ClaimSettlement {
  /** The comparison set the move is measured against, e.g. "XLF, and SPY". */
  benchmarks: string;
  /** The span and whether it can move, e.g. "90 days, fixed at entry". */
  window: string;
  /** The date the window closes and the claim is graded. */
  checked: string;
}

export interface ClaimData {
  id: string;
  /** Where this claim sits in today's brief. A count, never a rate. */
  position: { index: number; total: number };
  /** Sector or theme. Rendered as the eyebrow. */
  eyebrow: string;
  /** The falsifiable sentence. */
  claim: string;
  /** The desk's reading, one entry per paragraph. */
  reading: string[];
  /** What would settle the claim, and what would remove its premise. */
  settles: string;
  settlement: ClaimSettlement;
  /** Publication time of the brief this claim came from. Read by the stale state. */
  generatedAt: string;
}

export const CLAIM_FIXTURE: ClaimData = {
  id: "demo",
  position: { index: 2, total: 5 },
  eyebrow: "Financial services",
  claim: "Cash App gross profit growth outpaces Square's for a second consecutive quarter.",
  reading: [
    "Q2 put Cash App inflows per active at a new high while merchant GPV growth stayed in the low teens. Lending attach is doing most of the work: Borrow originations roughly doubled year over year against a book that still charges off inside guidance.",
    "Square is not deteriorating. It is compounding at the rate a mature acquiring business compounds, and the desk reads the gap between the two segments as widening for another two quarters before it closes.",
  ],
  settles:
    "The Q3 segment split, expected Nov 3. Cash App gross profit growth landing under Square's removes the premise outright.",
  settlement: {
    benchmarks: "XLF, and SPY",
    /* The design writes "90 days, fixed at entry" as a literal. The 90 is
       MAX_WINDOW_DAYS, so it is read from the module that owns it rather than
       typed again: a window that drifts from the clamp is the one number on
       this screen that would be a lie. */
    window: `${MAX_WINDOW_DAYS} days, fixed at entry`,
    checked: "2026-11-04",
  },
  generatedAt: "6:45 AM ET",
};

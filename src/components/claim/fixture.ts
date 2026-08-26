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

/* The production gate.
 *
 * There is no loader behind this screen. Every field below is invented, and
 * three of them could not be loaded even if a loader existed, which is what
 * the header above records. `/claim/[id]` requires a session in production, so
 * ungated this would put a fabricated Cash App call, a fabricated desk reading
 * and a fabricated benchmark pair in front of a real reader, headed by a
 * position counter claiming it is the second of five calls in their brief.
 *
 * Fails closed: anything that is not development and not an explicit preview
 * deploy is treated as production.
 *
 * With the gate closed the screen draws `unwired`, NOT a skeleton and NOT the
 * missing state. A skeleton says a read is on its way when nothing is coming,
 * and `missing` says a read came back and found nothing. Neither happened, so
 * the screen says the third thing. See `claim-screen.tsx`.
 *
 * One constant, imported at the only two places that need it, rather than a
 * condition to remember per call site.
 */
export const CLAIM_FIXTURE_ENABLED =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_VERCEL_ENV === "preview";

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
  /**
   * When the brief this claim came from was published, date and time.
   *
   * The date is not optional. The stale state is the only consumer and its
   * whole point is that the brief is not today's, so a bare time reads as this
   * morning and says the opposite of the sentence it sits in. The Ledger's
   * fixture carries a bare time because there it describes today.
   */
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
  generatedAt: "August 5, 6:45 AM ET",
};

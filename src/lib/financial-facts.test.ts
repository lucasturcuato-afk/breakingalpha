/**
 * Call-level tests for the bounded financials read.
 * Run: npx tsx --test src/lib/financial-facts.test.ts
 *
 * `financial_facts_latest` is a DISTINCT ON view, and Postgres pushes a qual
 * into a DISTINCT ON subquery only when the qual's column is in the DISTINCT ON
 * key. `cik` and `period_end` are; `fiscal_period` is not, and LIMIT cannot
 * apply before the dedup. So without a `period_end` bound the read materialises
 * a company's ENTIRE filing history to draw thirteen columns, and the cost
 * scales with that company's row count until the largest filers reach the
 * statement timeout and come back as 57014.
 *
 * What a reviewer cannot see by loading Nvidia is what the module now DOES with
 * that bound: a company that fills BOTH quotas inside the window must issue ONE
 * bounded read and stop, and a company that cannot fill EITHER of them must
 * widen to the full history rather than quietly drawing a short table. These
 * pin both, plus the failure contract that the bound must not weaken.
 *
 * Both dimensions, because the tab draws two tables off one read and they
 * exhaust the window at different rates. An annual-only filer clears the annual
 * quota several times over and still comes up short of the quarterly one, and
 * an annual-check-only guard leaves exactly that filer a column short.
 *
 * A NOTE ON WHAT THE FAKE HONOURS. It records the `gte("period_end", ...)` a
 * read was built with but does NOT apply it: read n returns the nth canned row
 * set verbatim. That is deliberate. The fixtures state what a window YIELDED
 * rather than deriving it from today's date, so no test's meaning drifts with
 * the calendar month.
 *
 * The fake client is a chainable thenable, the same shape
 * tests/unit/company-detail-article-window.test.ts uses: every PostgREST
 * builder method returns itself and records its arguments, and awaiting it
 * yields the canned row set queued for that table. That is enough to count
 * reads per table and to read back the `period_end` bound each read was built
 * with. Fixtures carry `accession_number: null` so no code path reaches the
 * network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchCompanyFinancials,
  factLookbackCutoff,
  ANNUAL_PERIODS,
  QUARTERLY_PERIODS,
  FACT_LOOKBACK_YEARS,
} from "./financial-facts";

type Canned = { data: unknown; error: unknown };
type Call = { table: string; index: number; method: string; args: unknown[] };

const CHAIN_METHODS = ["select", "eq", "ilike", "in", "gte", "lte", "order", "limit", "or"] as const;

function makeSupabase(plan: Record<string, Canned[]>) {
  const calls: Call[] = [];
  const counts: Record<string, number> = {};
  const from = (table: string) => {
    const index = counts[table] ?? 0;
    counts[table] = index + 1;
    const settle = () => {
      const queue = plan[table] ?? [];
      return queue[Math.min(index, queue.length - 1)] ?? { data: [], error: null };
    };
    const builder: Record<string, unknown> = {};
    for (const m of CHAIN_METHODS) {
      builder[m] = (...args: unknown[]) => {
        calls.push({ table, index, method: m, args });
        return builder;
      };
    }
    builder.maybeSingle = () => Promise.resolve(settle());
    builder.then = (ok: unknown, err: unknown) =>
      Promise.resolve(settle()).then(ok as never, err as never);
    return builder;
  };
  return {
    client: { from } as unknown as SupabaseClient,
    calls,
    factReadCount: () => counts.financial_facts_latest ?? 0,
    /** The `period_end` lower bound the nth facts read was built with, or null. */
    factCutoff: (n: number) => {
      const c = calls.find(
        (x) =>
          x.table === "financial_facts_latest" &&
          x.index === n &&
          x.method === "gte" &&
          x.args[0] === "period_end",
      );
      return c ? (c.args[1] as string) : null;
    },
  };
}

const COMPANY = [{ id: "c0000000-0000-0000-0000-000000000001", name: "Testco", ticker: "TST", sec_cik: 4242 }];

/** One validated annual row per fiscal year, newest first, USD. */
function annualRows(years: number[]) {
  return years.map((y) => ({
    metric_key: "revenue",
    period_type: "duration",
    fiscal_year: y,
    fiscal_period: "FY",
    period_end: `${y}-12-31`,
    unit: "USD",
    value: 1_000_000 * y,
    filing_url: null,
    accession_number: null,
  }));
}

const QUARTER_END = { Q1: "03-31", Q2: "06-30", Q3: "09-30", Q4: "12-31" } as const;

/** Four discrete-quarter income rows per fiscal year, USD. */
function quarterRows(years: number[]) {
  return years.flatMap((y) =>
    (["Q1", "Q2", "Q3", "Q4"] as const).map((q) => ({
      metric_key: "revenue",
      period_type: "duration",
      fiscal_year: y,
      fiscal_period: q,
      period_end: `${y}-${QUARTER_END[q]}`,
      unit: "USD",
      value: 250_000 * y,
      filing_url: null,
      accession_number: null,
    })),
  );
}

/**
 * An ANNUAL-ONLY filer, the 20-F shape: per fiscal year exactly one FY income
 * row and one FY year-end balance sheet, and no Q rows at all. The quarterly
 * view keys its columns by distinct period_end and takes every instant row, so
 * this filer draws ONE quarterly column per fiscal year. That is the whole
 * defect: its annual quota is five and its quarterly quota is eight, off the
 * same rows.
 *
 * A June year-end, because a real one is what makes the window bite: an
 * eight-year lookback whose edge lands mid-year admits seven such years, not
 * eight.
 */
function annualOnlyFilerRows(years: number[], unit = "TWD") {
  return years.flatMap((y) => [
    {
      metric_key: "revenue",
      period_type: "duration",
      fiscal_year: y,
      fiscal_period: "FY",
      period_end: `${y}-06-30`,
      unit,
      value: 1_000_000 * y,
      filing_url: null,
      accession_number: null,
    },
    {
      metric_key: "total_assets",
      period_type: "instant",
      fiscal_year: y,
      fiscal_period: "FY",
      period_end: `${y}-06-30`,
      unit,
      value: 2_000_000 * y,
      filing_url: null,
      accession_number: null,
    },
  ]);
}

const THIS_YEAR = new Date().getUTCFullYear();

/**
 * A company at BOTH quotas inside the window: five fiscal years of FY rows and
 * eight distinct quarter-ends. This is what "already at quota" has to mean, and
 * a fixture that satisfied only the annual half is what let the quarterly gap
 * ship. The FY rows are durations, so they never enter the quarterly column set
 * and the eight quarter-ends stand on their own.
 */
const AT_BOTH_QUOTAS = [
  ...annualRows([THIS_YEAR - 1, THIS_YEAR - 2, THIS_YEAR - 3, THIS_YEAR - 4, THIS_YEAR - 5]),
  ...quarterRows([THIS_YEAR - 1, THIS_YEAR - 2]),
];

// ---------------------------------------------------------------------------
// The guard. THIS is the test that must go red if the widening branch in
// fetchCompanyFinancials is deleted.
// ---------------------------------------------------------------------------
test("widens to the full history when the lookback window cannot fill the annual quota", async () => {
  // A dormant filer: every fiscal year it ever reported is older than the
  // window, so the bounded read comes back empty. The unbounded re-read is the
  // only thing that can draw its table.
  const dormant = [THIS_YEAR - 14, THIS_YEAR - 13, THIS_YEAR - 12, THIS_YEAR - 11, THIS_YEAR - 10];
  const s = makeSupabase({
    companies: [{ data: COMPANY, error: null }],
    financial_facts_latest: [
      { data: [], error: null }, // bounded: window is empty for this filer
      { data: annualRows(dormant), error: null }, // unbounded: the real history
    ],
    sec_filings: [{ data: [], error: null }],
  });

  const r = await fetchCompanyFinancials(s.client, { name: "Testco" });

  assert.equal(r.readFailed, false, "a successful widened read is not a failure");
  assert.equal(s.factReadCount(), 2, "must issue the bounded read AND the widening re-read");
  assert.equal(s.factCutoff(0), factLookbackCutoff(), "first read is bounded");
  assert.equal(s.factCutoff(1), null, "second read carries no period_end bound");
  assert.equal(
    r.annual.periods.length,
    ANNUAL_PERIODS,
    "the dormant filer's five annual columns must survive the lookback bound",
  );
  assert.deepEqual(
    r.annual.periods.map((p) => p.fiscalYear),
    [...dormant].sort((a, b) => b - a),
    "and they must be the years it actually filed",
  );
});

test("a filer that fills BOTH quotas inside the window issues exactly one read", async () => {
  // The fixture has to clear both dimensions, not just the annual one. An
  // annual-only fixture used to stand here and it passed for the wrong reason:
  // its quarterly population was empty, and only an annual-check-only guard
  // could call that "at quota".
  const s = makeSupabase({
    companies: [{ data: COMPANY, error: null }],
    financial_facts_latest: [{ data: AT_BOTH_QUOTAS, error: null }],
    sec_filings: [{ data: [], error: null }],
  });

  const r = await fetchCompanyFinancials(s.client, { name: "Testco" });

  assert.equal(s.factReadCount(), 1, "no widening read for a company already at quota");
  assert.equal(r.annual.periods.length, ANNUAL_PERIODS);
  assert.equal(r.quarterly.periods.length, QUARTERLY_PERIODS);
  assert.equal(r.readFailed, false);
});

// ---------------------------------------------------------------------------
// The quarterly half of the guard. THIS is the test that must go red if the
// `distinctQuarterlyPeriods(...) < QUARTERLY_PERIODS` clause is deleted.
// ---------------------------------------------------------------------------
test("widens when the window fills the annual quota but not the quarterly one", async () => {
  // The annual-only filer. Seven fiscal years inside the window is more than
  // ANNUAL_PERIODS, so the annual half of the guard is satisfied and cannot be
  // what fires; its quarterly table is still one column short of quota because
  // an annual filer contributes one quarterly column per year.
  const inWindow = [
    THIS_YEAR - 1, THIS_YEAR - 2, THIS_YEAR - 3, THIS_YEAR - 4,
    THIS_YEAR - 5, THIS_YEAR - 6, THIS_YEAR - 7,
  ];
  const wholeHistory = [...inWindow, THIS_YEAR - 8, THIS_YEAR - 9, THIS_YEAR - 10];
  assert.ok(
    inWindow.length > ANNUAL_PERIODS && inWindow.length < QUARTERLY_PERIODS,
    "the fixture must clear the annual quota and miss the quarterly one, or it proves nothing",
  );

  const s = makeSupabase({
    companies: [{ data: COMPANY, error: null }],
    financial_facts_latest: [
      { data: annualOnlyFilerRows(inWindow), error: null },
      { data: annualOnlyFilerRows(wholeHistory), error: null },
    ],
    sec_filings: [{ data: [], error: null }],
  });

  const r = await fetchCompanyFinancials(s.client, { name: "Testco" });

  assert.equal(r.readFailed, false, "a successful widened read is not a failure");
  assert.equal(s.factReadCount(), 2, "the quarterly shortfall alone must trigger the widening");
  assert.equal(s.factCutoff(0), factLookbackCutoff(), "first read is bounded");
  assert.equal(s.factCutoff(1), null, "second read carries no period_end bound");
  assert.equal(
    r.quarterly.periods.length,
    QUARTERLY_PERIODS,
    "the annual-only filer must recover its eighth quarterly column",
  );
  assert.deepEqual(
    r.quarterly.periods.map((p) => p.periodEnd),
    [...wholeHistory]
      .sort((a, b) => b - a)
      .slice(0, QUARTERLY_PERIODS)
      .map((y) => `${y}-06-30`),
    "and the eight columns must be its eight most recent year-ends",
  );
  assert.equal(r.annual.periods.length, ANNUAL_PERIODS, "the annual table is unharmed");
  assert.equal(r.reportingCurrency, "TWD", "a foreign filer keeps its own currency");
});

// ---------------------------------------------------------------------------
// The annual half of the guard, pinned on its own. THIS is the test that must
// go red if the `distinctAnnualPeriods(...) < ANNUAL_PERIODS` clause is
// deleted.
//
// It exists because the quarterly clause SUBSUMED the annual one in every
// other fixture: a dormant filer with no annual columns has no quarterly ones
// either, so deleting the annual clause left the whole suite green and the
// annual half untagged. Mutation, not reading, is what surfaced that.
// ---------------------------------------------------------------------------
test("widens when the window fills the quarterly quota but not the annual one", async () => {
  // The recent-listing shape: two fiscal years of complete 10-Q coverage. Eight
  // distinct quarter-ends is exactly QUARTERLY_PERIODS, so the quarterly half
  // of the guard is satisfied and cannot be what fires; two fiscal years is
  // short of ANNUAL_PERIODS.
  const recent = [THIS_YEAR - 1, THIS_YEAR - 2];
  const older = [THIS_YEAR - 3, THIS_YEAR - 4, THIS_YEAR - 5, THIS_YEAR - 6];
  const bounded = [...annualRows(recent), ...quarterRows(recent)];
  const wholeHistory = [...annualRows([...recent, ...older]), ...quarterRows(recent)];
  assert.equal(
    new Set(quarterRows(recent).map((r) => r.period_end)).size,
    QUARTERLY_PERIODS,
    "the fixture must clear the quarterly quota exactly, or it proves nothing",
  );

  const s = makeSupabase({
    companies: [{ data: COMPANY, error: null }],
    financial_facts_latest: [
      { data: bounded, error: null },
      { data: wholeHistory, error: null },
    ],
    sec_filings: [{ data: [], error: null }],
  });

  const r = await fetchCompanyFinancials(s.client, { name: "Testco" });

  assert.equal(r.readFailed, false);
  assert.equal(s.factReadCount(), 2, "the annual shortfall alone must trigger the widening");
  assert.equal(s.factCutoff(1), null, "second read carries no period_end bound");
  assert.equal(
    r.annual.periods.length,
    ANNUAL_PERIODS,
    "the short-history filer must recover its older annual columns",
  );
  assert.equal(r.quarterly.periods.length, QUARTERLY_PERIODS, "the quarterly table is unharmed");
});

// ---------------------------------------------------------------------------
// The currency election runs over whichever row population was finally read.
// Called out in review as changed-behaviour-with-no-coverage.
// ---------------------------------------------------------------------------
test("the reporting currency is elected from the widened rows, not the bounded sample", async () => {
  // The bounded window holds nothing but share counts, which carry no currency
  // at all, so selectReportingCurrency answers null over it. Reusing that null
  // for the widened rows would make filterToCurrency drop every TWD fact and
  // draw an empty table over a filer that has one.
  const shareCountsOnly = [THIS_YEAR - 1, THIS_YEAR - 2].map((y) => ({
    metric_key: "shares_basic",
    period_type: "duration",
    fiscal_year: y,
    fiscal_period: "FY",
    period_end: `${y}-06-30`,
    unit: "shares",
    value: 4_000_000,
    filing_url: null,
    accession_number: null,
  }));
  const wholeHistory = [
    THIS_YEAR - 1, THIS_YEAR - 2, THIS_YEAR - 3, THIS_YEAR - 4,
    THIS_YEAR - 5, THIS_YEAR - 6, THIS_YEAR - 7, THIS_YEAR - 8,
  ];
  const s = makeSupabase({
    companies: [{ data: COMPANY, error: null }],
    financial_facts_latest: [
      { data: shareCountsOnly, error: null },
      { data: annualOnlyFilerRows(wholeHistory), error: null },
    ],
    sec_filings: [{ data: [], error: null }],
  });

  const r = await fetchCompanyFinancials(s.client, { name: "Testco" });

  assert.equal(s.factReadCount(), 2);
  assert.equal(r.reportingCurrency, "TWD", "the election must re-run over the rows finally read");
  assert.equal(
    r.annual.periods.length,
    ANNUAL_PERIODS,
    "and the table must survive the currency filter that election drives",
  );
});

test("the first read is bounded on period_end by exactly FACT_LOOKBACK_YEARS", async () => {
  const s = makeSupabase({
    companies: [{ data: COMPANY, error: null }],
    financial_facts_latest: [{ data: AT_BOTH_QUOTAS, error: null }],
    sec_filings: [{ data: [], error: null }],
  });
  await fetchCompanyFinancials(s.client, { name: "Testco" });

  const cutoff = s.factCutoff(0);
  assert.ok(cutoff, "the bounded read must carry a period_end floor");
  const years = (new Date().getTime() - new Date(cutoff).getTime()) / (365.25 * 864e5);
  assert.ok(
    Math.abs(years - FACT_LOOKBACK_YEARS) < 0.02,
    `period_end floor should be ~${FACT_LOOKBACK_YEARS}y back, got ${years.toFixed(2)}y`,
  );
});

test("a failed bounded read still reports readFailed, not an empty company", async () => {
  const s = makeSupabase({
    companies: [{ data: COMPANY, error: null }],
    financial_facts_latest: [{ data: null, error: { message: "canceling statement due to statement timeout" } }],
    sec_filings: [{ data: [], error: null }],
  });

  const r = await fetchCompanyFinancials(s.client, { name: "Testco" });

  assert.equal(r.readFailed, true, "57014 must never be collapsed into an empty view");
  assert.equal(r.cik, 4242, "the CIK is known even when the read failed");
  assert.equal(r.annual.periods.length, 0);
});

test("a failed WIDENING read reports readFailed rather than a possibly-truncated table", async () => {
  // The bounded read returned something, but not enough to trust. Drawing it
  // anyway would assert a short filing history the company may not have.
  const s = makeSupabase({
    companies: [{ data: COMPANY, error: null }],
    financial_facts_latest: [
      { data: annualRows([THIS_YEAR - 1, THIS_YEAR - 2]), error: null },
      { data: null, error: { message: "canceling statement due to statement timeout" } },
    ],
    sec_filings: [{ data: [], error: null }],
  });

  const r = await fetchCompanyFinancials(s.client, { name: "Testco" });

  assert.equal(s.factReadCount(), 2);
  assert.equal(r.readFailed, true);
  assert.equal(r.annual.periods.length, 0, "no partial table is drawn as though it were whole");
});

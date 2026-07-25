/**
 * Unit tests for financials-derived-facts.ts. Pure, deterministic, no network.
 * Run: npx tsx --test src/lib/financials-derived-facts.test.ts
 *
 * The two fixtures at the top are the real tables that produced false streaks
 * from gemini-2.5-flash. They are the regression bar: the arithmetic here must
 * say two where the model said three, and one where the model said two.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDerivedFacts, formatDerivedFactsBlock } from "./financials-derived-facts";
import type { CompanyFinancialsResult, FinancialView } from "./financial-facts";

function cell(value: number) {
  return { value, filingUrl: null, accession: null };
}

/** Build an annual view from newest-first year/value pairs per metric. */
function annualView(years: number[], rows: Record<string, Array<number | null>>): FinancialView {
  const periods = years.map((y) => ({
    key: `FY-${y}`,
    label: `FY${y}`,
    fiscalYear: y,
    fiscalPeriod: "FY",
    periodEnd: `${y}-12-31`,
  }));
  const grid: FinancialView["grid"] = {};
  for (const [metric, values] of Object.entries(rows)) {
    grid[metric] = {};
    values.forEach((v, i) => {
      if (v !== null) grid[metric][`FY-${years[i]}`] = cell(v);
    });
  }
  return { periods, grid };
}

function company(annual: FinancialView): CompanyFinancialsResult {
  return { cik: 1, annual, quarterly: { periods: [], grid: {} } };
}

// Caterpillar, the real FY2021-FY2025 table. Operating cash flow fell in FY2024
// and FY2025 but ROSE in FY2023, so the run is two. The model claimed three.
const CATERPILLAR = company(
  annualView([2025, 2024, 2023, 2022, 2021], {
    operating_cash_flow: [11_739_000_000, 12_035_000_000, 12_885_000_000, 7_766_000_000, 7_198_000_000],
    total_assets: [98_585_000_000, 87_764_000_000, 87_476_000_000, 81_943_000_000, 82_793_000_000],
  }),
);

// Otter Tail, the real FY2021-FY2025 table. Operating income fell in FY2025 but
// ROSE in FY2024, so the run is one and no streak fact exists at all. The model
// claimed a second consecutive decrease.
const OTTER_TAIL = company(
  annualView([2025, 2024, 2023, 2022, 2021], {
    operating_income: [345_682_000, 380_250_000, 377_919_000, 390_439_000, 249_708_000],
    total_assets: [3_964_279_000, 3_652_082_000, 3_242_568_000, 2_901_661_000, 2_754_830_000],
  }),
);

test("a broken run is NOT reported as a run: Caterpillar operating cash flow is two, not three", () => {
  const facts = computeDerivedFacts(CATERPILLAR);
  const run = facts.find((f) => f.metricKey === "operating_cash_flow" && f.kind === "run_decrease");
  assert.ok(run, "the two-year decrease run should be derived");
  assert.equal(run!.runLength, 2);
  assert.equal(run!.startLabel, "FY2023");
  assert.equal(run!.endLabel, "FY2025");
  // FY2023 rose off FY2022, so nothing may claim a third consecutive decline.
  assert.ok(run!.runLength < 3);
  // And no increase run coexists.
  assert.equal(facts.some((f) => f.metricKey === "operating_cash_flow" && f.kind === "run_increase"), false);
});

test("a single move is not a streak: Otter Tail operating income yields no run fact", () => {
  const facts = computeDerivedFacts(OTTER_TAIL);
  const runs = facts.filter((f) => f.metricKey === "operating_income" && f.kind.startsWith("run_"));
  assert.deepEqual(runs, [], "one decrease preceded by an increase is not a run");
  // The YoY delta is still available to describe.
  const delta = facts.find((f) => f.metricKey === "operating_income" && f.kind === "delta");
  assert.ok(delta);
  assert.equal(delta!.latest, 345_682_000);
  assert.equal(delta!.previous, 380_250_000);
});

test("a true multi-year run is detected with its exact length", () => {
  const facts = computeDerivedFacts(CATERPILLAR);
  const run = facts.find((f) => f.metricKey === "total_assets" && f.kind === "run_increase");
  assert.ok(run);
  // FY2022 < FY2023 < FY2024 < FY2025 is three moves; FY2021 > FY2022 stops it.
  assert.equal(run!.runLength, 3);
  assert.equal(run!.startLabel, "FY2022");

  const otter = computeDerivedFacts(OTTER_TAIL).find(
    (f) => f.metricKey === "total_assets" && f.kind === "run_increase",
  );
  assert.ok(otter);
  assert.equal(otter!.runLength, 4);
  assert.equal(otter!.startLabel, "FY2021");
});

test("highest-in-N is correct and only when the newest period is the extreme", () => {
  const facts = computeDerivedFacts(CATERPILLAR);

  const high = facts.find((f) => f.metricKey === "total_assets" && f.kind === "extreme_high");
  assert.ok(high, "FY2025 total assets are the max of the five years");
  assert.equal(high!.periodsCovered, 5);

  // Operating cash flow peaked in FY2023, so FY2025 is neither high nor low.
  assert.equal(facts.some((f) => f.metricKey === "operating_cash_flow" && f.kind === "extreme_high"), false);
  assert.equal(facts.some((f) => f.metricKey === "operating_cash_flow" && f.kind === "extreme_low"), false);
});

test("lowest-in-N fires when the newest period is the minimum", () => {
  const falling = company(annualView([2025, 2024, 2023], { revenue: [80, 100, 120] }));
  const facts = computeDerivedFacts(falling);
  const low = facts.find((f) => f.metricKey === "revenue" && f.kind === "extreme_low");
  assert.ok(low);
  assert.equal(low!.periodsCovered, 3);
  assert.equal(facts.some((f) => f.metricKey === "revenue" && f.kind === "extreme_high"), false);
});

test("single-period tables produce no streak, extreme, or delta facts", () => {
  const one = company(annualView([2025], { revenue: [500], net_income: [50] }));
  const facts = computeDerivedFacts(one);
  assert.equal(facts.some((f) => f.kind.startsWith("run_")), false);
  assert.equal(facts.some((f) => f.kind.startsWith("extreme_")), false);
  assert.equal(facts.some((f) => f.kind === "delta"), false);
  assert.equal(formatDerivedFactsBlock(facts), "");
});

test("empty views produce no facts and an empty block", () => {
  const none: CompanyFinancialsResult = {
    cik: null,
    annual: { periods: [], grid: {} },
    quarterly: { periods: [], grid: {} },
  };
  assert.deepEqual(computeDerivedFacts(none), []);
  assert.equal(formatDerivedFactsBlock([]), "");
});

test("a gap in the series stops the run rather than counting through it", () => {
  // FY2023 is unreported. Only the FY2024 to FY2025 move is countable, which is
  // a run of one, below the streak threshold. Without the halt this would count
  // FY2022 as well and emit a claimable three-year run off a hole in the data.
  const gapped = company(annualView([2025, 2024, 2023, 2022], { revenue: [400, 300, null, 100] }));
  const runs = computeDerivedFacts(gapped).filter((f) => f.kind.startsWith("run_"));
  assert.deepEqual(runs, [], "counting must not bridge the missing period");

  // Same shape with the gap filled does produce the run, proving the halt is
  // what suppressed it rather than some unrelated guard.
  const filled = company(annualView([2025, 2024, 2023, 2022], { revenue: [400, 300, 200, 100] }));
  const run = computeDerivedFacts(filled).find((f) => f.kind === "run_increase" && f.metricKey === "revenue");
  assert.ok(run);
  assert.equal(run!.runLength, 3);
});

test("flat periods break a run: equality is neither increase nor decrease", () => {
  const flat = company(annualView([2025, 2024, 2023], { revenue: [100, 100, 50] }));
  const runs = computeDerivedFacts(flat).filter((f) => f.kind.startsWith("run_"));
  assert.deepEqual(runs, []);
});

test("margins are derived so margin trends have a verifiable basis", () => {
  const m = company(
    annualView([2025, 2024, 2023], {
      revenue: [1000, 900, 800],
      operating_income: [200, 150, 100],
    }),
  );
  const facts = computeDerivedFacts(m);
  const run = facts.find((f) => f.metricKey === "operating_margin" && f.kind === "run_increase");
  assert.ok(run, "20% > 16.67% > 12.5% is a two-year margin expansion");
  assert.equal(run!.runLength, 2);
});

test("first-positive fires only when every earlier period is non-positive", () => {
  const flip = company(annualView([2025, 2024, 2023], { operating_income: [40, -10, -80] }));
  assert.ok(computeDerivedFacts(flip).some((f) => f.kind === "first_positive" && f.metricKey === "operating_income"));

  // A prior positive year disqualifies it.
  const notFirst = company(annualView([2025, 2024, 2023], { operating_income: [40, -10, 60] }));
  assert.equal(computeDerivedFacts(notFirst).some((f) => f.kind === "first_positive"), false);
});

test("the rendered block states the run length and pins that it goes no further", () => {
  const block = formatDerivedFactsBlock(computeDerivedFacts(CATERPILLAR));
  assert.match(block, /ANNUAL:/);
  assert.match(block, /Operating cash flow: decreased in 2 consecutive fiscal years, FY2023 through FY2025\./);
  assert.match(block, /The run is exactly 2; it does not extend further back\./);
  assert.ok(!block.includes("—"), "zero em-dashes");
});

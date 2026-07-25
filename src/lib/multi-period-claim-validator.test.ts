/**
 * Unit tests for multi-period-claim-validator.ts. Pure, deterministic, no network.
 * Run: npx tsx --test src/lib/multi-period-claim-validator.test.ts
 *
 * The planted sentences are the verbatim ones gemini-2.5-flash actually emitted
 * against these tables. The false ones must be stripped; the true ones must
 * survive untouched, because a validator that eats correct prose is not usable.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDerivedFacts } from "./financials-derived-facts";
import { validateMultiPeriodClaims } from "./multi-period-claim-validator";
import type { CompanyFinancialsResult, FinancialView } from "./financial-facts";

function cell(value: number) {
  return { value, filingUrl: null, accession: null };
}

function annualView(years: number[], rows: Record<string, number[]>): FinancialView {
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
    values.forEach((v, i) => (grid[metric][`FY-${years[i]}`] = cell(v)));
  }
  return { periods, grid };
}

function company(annual: FinancialView): CompanyFinancialsResult {
  return { cik: 1, annual, quarterly: { periods: [], grid: {} } };
}

const CATERPILLAR = company(
  annualView([2025, 2024, 2023, 2022, 2021], {
    revenue: [67_589_000_000, 64_809_000_000, 67_060_000_000, 59_427_000_000, 50_971_000_000],
    operating_income: [11_151_000_000, 13_072_000_000, 12_966_000_000, 7_904_000_000, 6_878_000_000],
    operating_cash_flow: [11_739_000_000, 12_035_000_000, 12_885_000_000, 7_766_000_000, 7_198_000_000],
    total_assets: [98_585_000_000, 87_764_000_000, 87_476_000_000, 81_943_000_000, 82_793_000_000],
  }),
);

const OTTER_TAIL = company(
  annualView([2025, 2024, 2023, 2022, 2021], {
    revenue: [1_299_640_000, 1_329_973_000, 1_353_476_000, 1_469_475_000, 1_197_635_000],
    operating_income: [345_682_000, 380_250_000, 377_919_000, 390_439_000, 249_708_000],
    total_assets: [3_964_279_000, 3_652_082_000, 3_242_568_000, 2_901_661_000, 2_754_830_000],
  }),
);

const CAT_FACTS = computeDerivedFacts(CATERPILLAR);
const OTTER_FACTS = computeDerivedFacts(OTTER_TAIL);

test("planted false streak is stripped: the real Caterpillar 'third consecutive year'", () => {
  const text =
    "Operating cash flow decreased for the third consecutive year to $11.74 billion in FY2025.";
  const r = validateMultiPeriodClaims(text, CAT_FACTS);
  assert.equal(r.blocked, true);
  assert.equal(r.clean, "");
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0].reason, /claimed 3 consecutive but the computed run is 2/);
});

test("planted false streak is stripped: the real Otter Tail 'second consecutive annual decrease'", () => {
  const text =
    "Operating income also declined in FY2025 by $34.6 million, marking the second consecutive annual decrease.";
  const r = validateMultiPeriodClaims(text, OTTER_FACTS);
  assert.equal(r.blocked, true);
  assert.equal(r.clean, "");
  assert.match(r.findings[0].reason, /no run_decrease run for operating_income/);
});

test("a TRUE streak that IS in the derived facts passes untouched", () => {
  const text = "Total assets have increased each year since FY2022, reaching $98.59 billion in FY2025.";
  const r = validateMultiPeriodClaims(text, CAT_FACTS);
  assert.equal(r.blocked, false);
  assert.equal(r.clean, text);
  assert.deepEqual(r.findings, []);
});

test("a TRUE counted streak passes: Otter Tail total assets, four straight years", () => {
  const text = "Total assets have increased in each of the last four fiscal years, reaching $3.96 billion in FY2025.";
  const r = validateMultiPeriodClaims(text, OTTER_FACTS);
  assert.equal(r.blocked, false);
  assert.equal(r.clean, text);
});

test("claiming MORE years than the run is stripped even when a run exists", () => {
  // The real run is four; five is one too many.
  const text = "Total assets increased for the fifth consecutive year in FY2025.";
  const r = validateMultiPeriodClaims(text, OTTER_FACTS);
  assert.equal(r.blocked, true);
  assert.match(r.findings[0].reason, /claimed 5 consecutive but the computed run is 4/);
});

test("claiming FEWER years than the run is true and passes", () => {
  const text = "Total assets rose for a second consecutive year in FY2025.";
  const r = validateMultiPeriodClaims(text, OTTER_FACTS);
  assert.equal(r.blocked, false);
  assert.equal(r.clean, text);
});

test("wrong direction is stripped: the run is up, the sentence says down", () => {
  const text = "Total assets declined for three consecutive years through FY2025.";
  const r = validateMultiPeriodClaims(text, OTTER_FACTS);
  assert.equal(r.blocked, true);
  assert.match(r.findings[0].reason, /no run_decrease run for total_assets/);
});

test("a 'since FY' claim reaching further back than the run is stripped", () => {
  // The Caterpillar total-assets run starts at FY2022, not FY2021.
  const text = "Total assets have increased every year since FY2021.";
  const r = validateMultiPeriodClaims(text, CAT_FACTS);
  assert.equal(r.blocked, true);
  assert.match(r.findings[0].reason, /run does not reach back to 2021/);
});

test("false extreme is stripped, true extreme survives", () => {
  const falseHigh = "Operating cash flow reached its highest level in five years in FY2025.";
  const bad = validateMultiPeriodClaims(falseHigh, CAT_FACTS);
  assert.equal(bad.blocked, true, "FY2023 was the peak, not FY2025");

  const trueHigh = "Total assets reached their highest level in five years in FY2025.";
  const good = validateMultiPeriodClaims(trueHigh, CAT_FACTS);
  assert.equal(good.blocked, false);
  assert.equal(good.clean, trueHigh);
});

test("an unsupported 'first positive' is stripped", () => {
  const text = "FY2025 marked the first positive operating income in the periods shown.";
  const r = validateMultiPeriodClaims(text, CAT_FACTS);
  assert.equal(r.blocked, true);
  assert.match(r.findings[0].reason, /no first_positive fact/);
});

test("plain single-period sentences are never touched", () => {
  const text = [
    "Caterpillar's revenue increased to $67.59 billion in FY2025, a 4.3% increase from FY2024.",
    "Operating income was $11.15 billion in FY2025, a 14.7% decrease year over year.",
    "Diluted EPS was $18.81, down from $22.05 in FY2024.",
  ].join(" ");
  const r = validateMultiPeriodClaims(text, CAT_FACTS);
  assert.equal(r.blocked, false);
  assert.equal(r.clean, text);
});

test("mixed paragraph: only the false sentence is removed, the rest is preserved in order", () => {
  const text = [
    "Caterpillar's revenue increased to $67.59 billion in FY2025, a 4.3% increase from FY2024.",
    "Operating cash flow decreased for the third consecutive year to $11.74 billion in FY2025.",
    "Total assets have increased each year since FY2022, reaching $98.59 billion in FY2025.",
  ].join(" ");
  const r = validateMultiPeriodClaims(text, CAT_FACTS);
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0].sentence, /third consecutive year/);
  assert.equal(
    r.clean,
    "Caterpillar's revenue increased to $67.59 billion in FY2025, a 4.3% increase from FY2024. " +
      "Total assets have increased each year since FY2022, reaching $98.59 billion in FY2025.",
  );
});

test("a streak about a metric not in the data is stripped, not assumed", () => {
  const text = "Free cash flow rose for four consecutive years.";
  const r = validateMultiPeriodClaims(text, CAT_FACTS);
  assert.equal(r.blocked, true);
});

test("empty input and empty fact set are handled without throwing", () => {
  assert.deepEqual(validateMultiPeriodClaims("", CAT_FACTS), { clean: "", findings: [], blocked: false });
  assert.deepEqual(validateMultiPeriodClaims(null, CAT_FACTS), { clean: "", findings: [], blocked: false });
  // No derived facts means no multi-period claim can be verified.
  const r = validateMultiPeriodClaims("Revenue rose for three consecutive years.", []);
  assert.equal(r.blocked, true);
  assert.equal(r.clean, "");
});

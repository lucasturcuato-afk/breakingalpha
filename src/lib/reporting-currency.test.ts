/**
 * Unit tests for reporting-currency.ts and currency-mislabel-guard.ts.
 * Run: npx tsx --test src/lib/reporting-currency.test.ts
 *
 * Fixtures are the real unit distributions measured from the extractor:
 * TSMC {TWD: 255, TWD/shares: 48, shares: 34}, AMD {USD: 1871, USD/shares: 576,
 * shares: 576}.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  expectedUnit,
  currencyOfUnit,
  selectReportingCurrency,
  filterToCurrency,
  currencyPrefix,
  formatMoney,
  currencyNote,
  isNonUsd,
} from "./reporting-currency";
import { guardCurrencyMislabel } from "./currency-mislabel-guard";

const row = (metric_key: string, unit: string) => ({ metric_key, unit });

const TSMC_ROWS = [
  row("revenue", "TWD"),
  row("net_income", "TWD"),
  row("total_assets", "TWD"),
  row("eps_diluted", "TWD/shares"),
  row("shares_diluted", "shares"),
];
const AMD_ROWS = [
  row("revenue", "USD"),
  row("net_income", "USD"),
  row("eps_diluted", "USD/shares"),
  row("shares_diluted", "shares"),
];

test("currencyOfUnit reads the currency out of both unit shapes", () => {
  assert.equal(currencyOfUnit("TWD"), "TWD");
  assert.equal(currencyOfUnit("TWD/shares"), "TWD");
  assert.equal(currencyOfUnit("USD/shares"), "USD");
  assert.equal(currencyOfUnit("shares"), null, "a share count has no currency");
  assert.equal(currencyOfUnit(null), null);
  assert.equal(currencyOfUnit("pure"), null, "stray units are not currencies");
  assert.equal(currencyOfUnit("BillionsCubicFeet"), null);
});

test("selectReportingCurrency picks TWD for TSMC and USD for AMD", () => {
  assert.equal(selectReportingCurrency(TSMC_ROWS), "TWD");
  assert.equal(selectReportingCurrency(AMD_ROWS), "USD");
});

test("USD wins a tie so a convenience translation cannot displace the filer currency", () => {
  const mixed = [row("revenue", "TWD"), row("revenue", "USD")];
  assert.equal(selectReportingCurrency(mixed), "USD");
});

test("the majority currency wins when there is no tie", () => {
  const mostlyTwd = [row("revenue", "TWD"), row("net_income", "TWD"), row("revenue", "USD")];
  assert.equal(selectReportingCurrency(mostlyTwd), "TWD");
});

test("no monetary rows yields null rather than a guessed USD", () => {
  assert.equal(selectReportingCurrency([row("shares_diluted", "shares")]), null);
  assert.equal(selectReportingCurrency([]), null);
});

test("expectedUnit derives the accepted unit from the currency, not a constant", () => {
  assert.equal(expectedUnit("revenue", "TWD"), "TWD");
  assert.equal(expectedUnit("eps_diluted", "TWD"), "TWD/shares");
  assert.equal(expectedUnit("shares_diluted", "TWD"), "shares", "share counts are currency-free");
  assert.equal(expectedUnit("revenue", "USD"), "USD");
  assert.equal(expectedUnit("not_a_metric", "USD"), null, "unknown metrics are still dropped");
});

test("filterToCurrency keeps TSMC's TWD rows, which the old USD pin dropped entirely", () => {
  const kept = filterToCurrency(TSMC_ROWS, "TWD");
  assert.equal(kept.length, 5, "all five survive");
  // Proof of the original bug: pinning to USD drops everything except shares.
  const underOldPin = filterToCurrency(TSMC_ROWS, "USD");
  assert.deepEqual(underOldPin.map((r) => r.metric_key), ["shares_diluted"]);
});

test("filterToCurrency never lets a second currency into the series", () => {
  const contaminated = [...TSMC_ROWS, row("revenue", "USD"), row("net_income", "USD")];
  const kept = filterToCurrency(contaminated, "TWD");
  assert.equal(kept.every((r) => r.unit === "TWD" || r.unit === "TWD/shares" || r.unit === "shares"), true);
  assert.equal(kept.some((r) => r.unit === "USD"), false);
});

test("a null currency keeps only share counts, never bare numbers", () => {
  const kept = filterToCurrency(TSMC_ROWS, null);
  assert.deepEqual(kept.map((r) => r.metric_key), ["shares_diluted"]);
});

test("AMD is unaffected: same rows in, same rows out", () => {
  assert.deepEqual(filterToCurrency(AMD_ROWS, "USD"), AMD_ROWS);
});

test("non-USD renders as a code, never as a bare dollar sign", () => {
  assert.equal(currencyPrefix("USD"), "$");
  assert.equal(currencyPrefix("TWD"), "TWD ");
  assert.equal(currencyPrefix("DKK"), "DKK ");
  assert.equal(currencyPrefix(null), "");
  // The exact production failure: TSMC FY2024 revenue must not read "$2.89T".
  assert.equal(formatMoney(2_894_307_700_000, "TWD"), "TWD 2.89T");
  assert.equal(formatMoney(2_894_307_700_000, "USD"), "$2.89T");
  assert.ok(!formatMoney(2_894_307_700_000, "TWD").includes("$"));
});

test("money formatting scales and preserves sign", () => {
  assert.equal(formatMoney(0, "USD"), "$0");
  assert.equal(formatMoney(12_500, "USD"), "$12.5K");
  assert.equal(formatMoney(-2_204_427.96, "USD"), "-$2.20M");
  assert.equal(formatMoney(null, "USD"), "n/a");
  assert.equal(formatMoney(NaN, "USD"), "n/a");
});

test("isNonUsd and currencyNote drive the UI banner", () => {
  assert.equal(isNonUsd("TWD"), true);
  assert.equal(isNonUsd("USD"), false);
  assert.equal(isNonUsd(null), false, "unknown is not a claim of foreignness");
  assert.equal(currencyNote("TWD"), "Figures in TWD as reported.");
  assert.equal(currencyNote(null), "");
});

// --- currency-mislabel-guard ---

test("guard strips a dollar-denominated sentence from a TWD filer", () => {
  const text =
    "Taiwan Semiconductor reported revenue of $2.89 trillion in FY2024. Net income was 1.16 trillion TWD.";
  const r = guardCurrencyMislabel(text, "TWD");
  assert.equal(r.blocked, true);
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0].sentence, /\$2\.89 trillion/);
  assert.match(r.findings[0].reason, /filer reports in TWD/);
  assert.equal(r.clean, "Net income was 1.16 trillion TWD.");
});

test("guard catches the word dollars, not just the symbol", () => {
  const r = guardCurrencyMislabel("Revenue rose to 2.89 trillion dollars.", "TWD");
  assert.equal(r.blocked, true);
  assert.equal(r.clean, "");
});

test("guard is a strict no-op for a USD filer", () => {
  const text = "AMD reported revenue of $34.64 billion in FY2025. Net income was $4.34 billion.";
  const r = guardCurrencyMislabel(text, "USD");
  assert.equal(r.blocked, false);
  assert.equal(r.clean, text);
  assert.deepEqual(r.findings, []);
});

test("guard is a no-op when the currency is unknown", () => {
  const text = "Revenue was $10 million.";
  assert.equal(guardCurrencyMislabel(text, null).clean, text);
});

test("guard handles empty input without throwing", () => {
  assert.deepEqual(guardCurrencyMislabel("", "TWD"), { clean: "", findings: [], blocked: false });
  assert.deepEqual(guardCurrencyMislabel(null, "TWD"), { clean: "", findings: [], blocked: false });
});

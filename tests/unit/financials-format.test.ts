// Unit tests for the Financials tab cell formatter
// (src/components/company/tabs/financials-format.ts).
//
// The null/absent contract is NOT the formatter's job: ValueCell
// (FinancialsTab.tsx) renders the em-dash for missing or non-finite cells
// BEFORE formatting, so formatValue only ever receives finite numbers. These
// tests pin the zero case ("$0", never "$0K") and the unchanged non-zero
// magnitudes.
//
// Run: node --test tests/unit/financials-format.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatValue } from "../../src/components/company/tabs/financials-format.ts";

test("a reported zero renders $0, not $0K", () => {
  assert.equal(formatValue(0, "usd"), "$0");
});

test("non-zero magnitudes are unchanged", () => {
  assert.equal(formatValue(136_000_000, "usd"), "$136.0M");
  assert.equal(formatValue(5_030_000_000, "usd"), "$5.03B");
  assert.equal(formatValue(412_000, "usd"), "$412K");
  // sub-1K non-zero values keep today's behavior (only exact zero changed)
  assert.equal(formatValue(400, "usd"), "$0K");
});

test("negatives keep parentheses", () => {
  assert.equal(formatValue(-162_502_000, "usd"), "($162.5M)");
});

test("eps and shares formats untouched", () => {
  assert.equal(formatValue(7.46, "eps"), "$7.46");
  assert.equal(formatValue(-0.65, "eps"), "($0.65)");
  assert.equal(formatValue(14_710_000_000, "shares"), "14,710M");
});

test("gross margin percent untouched", () => {
  assert.equal(formatValue(0.4691, "pct"), "46.9%");
});

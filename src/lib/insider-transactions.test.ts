/**
 * Unit tests for insider-transactions.ts. Pure, deterministic, no network.
 * Run: npx tsx --test src/lib/insider-transactions.test.ts
 *
 * Fixtures are real rows from insider_transactions: TSM VP open-market
 * purchases and a Silver Lake block sale of DELL.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TRANSACTION_CODES,
  describeCode,
  categoryOf,
  groupByCategory,
  sortNewestFirst,
  formatDate,
  formatShares,
  formatPrice,
  formatValue,
  formatRole,
  type InsiderTransaction,
} from "./insider-transactions";

function tx(over: Partial<InsiderTransaction> & { id: string }): InsiderTransaction {
  return {
    accessionNumber: null,
    insiderName: null,
    insiderTitle: null,
    transactionCode: null,
    transactionDate: null,
    filedDate: null,
    shares: null,
    pricePerShare: null,
    totalValue: null,
    sharesOwnedAfter: null,
    documentUrl: null,
    ...over,
  };
}

// Real rows.
const TSM_BUY = tx({
  id: "tsm-1",
  accessionNumber: "0001046179-26-000457",
  insiderName: "Tien Bor-Zen",
  insiderTitle: "VP",
  transactionCode: "P",
  transactionDate: "2026-07-21",
  shares: 1000,
  pricePerShare: 73.98,
  totalValue: 73980,
  sharesOwnedAfter: 2000,
});
const DELL_SELL = tx({
  id: "dell-1",
  accessionNumber: "0001193125-26-302200",
  insiderName: "Silver Lake Partners V DE (AIV), L.P.",
  insiderTitle: null,
  transactionCode: "S",
  transactionDate: "2026-07-09",
  shares: 4887,
  pricePerShare: 451.08,
  totalValue: 2204427.96,
  sharesOwnedAfter: 69559,
});

test("every documented SEC code translates to plain English", () => {
  assert.equal(describeCode("P").label, "Open-market purchase");
  assert.equal(describeCode("S").label, "Open-market sale");
  assert.equal(describeCode("A").label, "Grant or award");
  assert.equal(describeCode("M").label, "Option exercise");
  assert.equal(describeCode("F").label, "Shares withheld for taxes");
  assert.equal(describeCode("G").label, "Gift");
  assert.equal(describeCode("C").label, "Conversion of derivative");
  assert.equal(Object.keys(TRANSACTION_CODES).length, 7);
});

test("P and S are open market; A, M and F are routine compensation", () => {
  assert.equal(categoryOf("P"), "open_market");
  assert.equal(categoryOf("S"), "open_market");
  assert.equal(categoryOf("A"), "routine");
  assert.equal(categoryOf("M"), "routine");
  assert.equal(categoryOf("F"), "routine");
  // G and C are neither: they are not market activity and not compensation.
  assert.equal(categoryOf("G"), "other");
  assert.equal(categoryOf("C"), "other");
});

test("an unknown code is surfaced as-is, never guessed into a category", () => {
  const d = describeCode("X");
  assert.equal(d.label, "Code X");
  assert.equal(d.category, "other");
  assert.equal(d.direction, null);
});

test("null, empty and lowercase codes are handled without throwing", () => {
  assert.equal(describeCode(null).label, "Unspecified");
  assert.equal(describeCode("").label, "Unspecified");
  assert.equal(describeCode(undefined).label, "Unspecified");
  assert.equal(describeCode(" p ").label, "Open-market purchase", "trims and upcases");
});

test("grouping keeps an RSU vest out of the open-market table", () => {
  const grant = tx({ id: "g", transactionCode: "A", shares: 5000 });
  const withheld = tx({ id: "f", transactionCode: "F", shares: 1800 });
  const gift = tx({ id: "gift", transactionCode: "G" });
  const groups = groupByCategory([TSM_BUY, grant, DELL_SELL, withheld, gift]);

  assert.deepEqual(groups.openMarket.map((r) => r.id), ["tsm-1", "dell-1"]);
  assert.deepEqual(groups.routine.map((r) => r.id), ["g", "f"]);
  assert.deepEqual(groups.other.map((r) => r.id), ["gift"]);
  // The distinction is the whole point: a grant must never sit beside a purchase.
  assert.equal(groups.openMarket.some((r) => r.transactionCode === "A"), false);
});

test("grouping an all-open-market set leaves routine empty, which is today's real data", () => {
  // Production currently holds only P and S: the parser drops other codes.
  const groups = groupByCategory([TSM_BUY, DELL_SELL]);
  assert.equal(groups.openMarket.length, 2);
  assert.deepEqual(groups.routine, []);
  assert.deepEqual(groups.other, []);
});

test("empty input groups cleanly", () => {
  assert.deepEqual(groupByCategory([]), { openMarket: [], routine: [], other: [] });
});

test("sort is newest-first and deterministic on ties", () => {
  const older = tx({ id: "a", transactionDate: "2026-01-01" });
  const newer = tx({ id: "b", transactionDate: "2026-07-21" });
  const nullDate = tx({ id: "c", transactionDate: null });
  assert.deepEqual(sortNewestFirst([older, nullDate, newer]).map((r) => r.id), ["b", "a", "c"]);

  const t1 = tx({ id: "x", transactionDate: "2026-07-21", accessionNumber: "0001" });
  const t2 = tx({ id: "y", transactionDate: "2026-07-21", accessionNumber: "0001" });
  assert.deepEqual(sortNewestFirst([t2, t1]).map((r) => r.id), ["x", "y"], "id breaks the final tie");
});

test("sortNewestFirst does not mutate its input", () => {
  const input = [tx({ id: "a", transactionDate: "2020-01-01" }), tx({ id: "b", transactionDate: "2026-01-01" })];
  const before = input.map((r) => r.id);
  sortNewestFirst(input);
  assert.deepEqual(input.map((r) => r.id), before);
});

test("formatters render the real TSM and DELL rows", () => {
  assert.equal(formatDate(TSM_BUY.transactionDate), "Jul 21, 2026");
  assert.equal(formatShares(TSM_BUY.shares), "1,000");
  assert.equal(formatPrice(TSM_BUY.pricePerShare), "$73.98");
  assert.equal(formatValue(TSM_BUY.totalValue), "$74.0K");
  assert.equal(formatRole(TSM_BUY.insiderTitle), "VP");

  assert.equal(formatShares(DELL_SELL.shares), "4,887");
  assert.equal(formatPrice(DELL_SELL.pricePerShare), "$451.08");
  assert.equal(formatValue(DELL_SELL.totalValue), "$2.20M");
  assert.equal(formatRole(DELL_SELL.insiderTitle), "Not stated", "entity filers carry no title");
});

test("formatters degrade to n/a rather than rendering NaN or zero", () => {
  assert.equal(formatDate(null), "n/a");
  assert.equal(formatShares(null), "n/a");
  assert.equal(formatPrice(null), "n/a");
  assert.equal(formatValue(null), "n/a");
  assert.equal(formatShares(NaN), "n/a");
  assert.equal(formatValue(Infinity), "n/a");
});

test("value formatting scales across magnitudes", () => {
  assert.equal(formatValue(950), "$950");
  assert.equal(formatValue(12_500), "$12.5K");
  assert.equal(formatValue(2_204_427.96), "$2.20M");
  assert.equal(formatValue(3_100_000_000), "$3.10B");
  assert.equal(formatValue(-2_204_427.96), "-$2.20M".replace("-$", "$-"), "sign is preserved");
});

test("no output carries signal or interpretation language", () => {
  const banned = /bullish|bearish|signal|conviction|confidence|positive|negative|strong|weak|buy the|opportunity/i;
  for (const meaning of Object.values(TRANSACTION_CODES)) {
    assert.equal(banned.test(meaning.label), false, `"${meaning.label}" must state the code, not judge it`);
  }
});

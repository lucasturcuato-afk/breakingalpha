/**
 * Unit tests for filing-categories.ts. Pure, deterministic, no network.
 * Run: npx tsx --test src/lib/filing-categories.test.ts
 *
 * The TSM fixture is the real production shape: every stored filing is a Form 4.
 * That case is why the default view needs its own empty state.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  categorizeForm,
  baseForm,
  isMaterialByDefault,
  countByCategory,
  applyFilter,
  FILTER_ORDER,
} from "./filing-categories";

const f = (formType: string | null) => ({ formType });

test("material US forms land in the right categories", () => {
  assert.equal(categorizeForm("10-K"), "annual");
  assert.equal(categorizeForm("10-Q"), "quarterly");
  assert.equal(categorizeForm("8-K"), "events");
  assert.equal(categorizeForm("S-1"), "events");
  assert.equal(categorizeForm("DEF 14A"), "events");
});

test("foreign private issuer forms are material, not other", () => {
  // The TSM case: without these, a foreign filer's real filings would be
  // classified "other" and read as junk.
  assert.equal(categorizeForm("20-F"), "annual");
  assert.equal(categorizeForm("40-F"), "annual");
  assert.equal(categorizeForm("6-K"), "events");
});

test("Forms 3, 4 and 5 are insider and are excluded from the default view", () => {
  for (const form of ["3", "4", "5"]) {
    assert.equal(categorizeForm(form), "insider");
    assert.equal(isMaterialByDefault(form), false);
  }
});

test("amendment variants follow their base form", () => {
  assert.equal(baseForm("10-K/A"), "10-K");
  assert.equal(categorizeForm("10-K/A"), "annual");
  assert.equal(categorizeForm("10-Q/A"), "quarterly");
  assert.equal(categorizeForm("8-K/A"), "events");
  assert.equal(categorizeForm("4/A"), "insider");
  assert.equal(isMaterialByDefault("4/A"), false, "amended Form 4 is still insider");
});

test("case and whitespace do not change classification", () => {
  assert.equal(categorizeForm(" 10-k "), "annual");
  assert.equal(categorizeForm("def 14a"), "events");
});

test("unknown and null forms are 'other' and STAY in the default view", () => {
  // Deliberate: an unclassified form is more likely something to surface than
  // something to suppress. Only insider forms are defaulted away.
  assert.equal(categorizeForm("SC 13D"), "other");
  assert.equal(categorizeForm(null), "other");
  assert.equal(isMaterialByDefault("SC 13D"), true);
  assert.equal(isMaterialByDefault(null), true);
});

test("counts are correct and total to the input length", () => {
  const filings = [f("10-K"), f("10-Q"), f("10-Q"), f("8-K"), f("4"), f("4"), f("4"), f("SC 13D")];
  const counts = countByCategory(filings);
  assert.equal(counts.all, 8);
  assert.equal(counts.annual, 1);
  assert.equal(counts.quarterly, 2);
  assert.equal(counts.events, 1);
  assert.equal(counts.insider, 3);
  assert.equal(counts.other, 1);
  const summed = counts.annual + counts.quarterly + counts.events + counts.insider + counts.other;
  assert.equal(summed, counts.all, "every filing lands in exactly one category");
});

test("default view drops insider forms and keeps everything else", () => {
  const filings = [f("10-K"), f("4"), f("6-K"), f("4"), f("SC 13D")];
  const visible = applyFilter(filings, null);
  assert.deepEqual(visible.map((x) => x.formType), ["10-K", "6-K", "SC 13D"]);
  assert.equal(visible.some((x) => x.formType === "4"), false);
});

test("the All chip reveals insider forms again: nothing is unreachable", () => {
  const filings = [f("10-K"), f("4"), f("4")];
  assert.equal(applyFilter(filings, "all").length, 3);
  assert.equal(applyFilter(filings, "insider").length, 2);
});

test("TSM shape: every filing is a Form 4, so the default view is empty", () => {
  // 69 of 69 real TSM sec_filings rows are Form 4. This must not look like a
  // bug; the tab renders a specific empty state pointing at the Insider chip.
  const tsm = Array.from({ length: 69 }, () => f("4"));
  const counts = countByCategory(tsm);
  assert.equal(counts.insider, 69);
  assert.equal(counts.all, 69);
  assert.equal(applyFilter(tsm, null).length, 0, "default view is empty for TSM");
  assert.equal(applyFilter(tsm, "insider").length, 69, "and the chip brings them all back");
});

test("filtering preserves input order", () => {
  const filings = [f("10-K"), f("4"), f("10-Q"), f("8-K")];
  assert.deepEqual(applyFilter(filings, null).map((x) => x.formType), ["10-K", "10-Q", "8-K"]);
});

test("empty input is safe for every filter", () => {
  for (const filter of [null, ...FILTER_ORDER]) {
    assert.deepEqual(applyFilter([], filter), []);
  }
  assert.equal(countByCategory([]).all, 0);
});

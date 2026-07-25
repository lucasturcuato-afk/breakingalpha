/**
 * Unit tests for compliance-language-filter.ts. Pure, deterministic, no network.
 * Run: npx tsx --test src/lib/compliance-language-filter.test.ts
 *
 * Proves the standalone backstop strips/flags the prohibited language the prompt
 * is told to avoid, and leaves descriptive figure-and-delta prose untouched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterComplianceLanguage,
  scanCompliance,
  matchProhibited,
} from "./compliance-language-filter";

// Descriptive, own-history commentary. Must survive the filter untouched.
const CLEAN =
  "Revenue rose to 471.0 million in FY2024 from 328.3 million in FY2023, a 43 percent YoY increase. Operating margin expanded in each of the last four quarters. FY2024 was the first year of positive operating income in the periods shown. EPS diluted was 0.12.";

test("clean descriptive commentary passes untouched", () => {
  const r = filterComplianceLanguage(CLEAN);
  assert.equal(r.blocked, false);
  assert.equal(r.findings.length, 0);
  assert.equal(r.clean, CLEAN);
});

test("planted prohibited phrasings are stripped and flagged", () => {
  // Each is a full sentence that must be removed; the specific phrase Noah cited.
  const cases: Array<[string, string]> = [
    ["The stock looks undervalued at current levels.", "valuation"],
    ["This is a compelling buy for long-term investors.", "recommendation"],
    ["Shares are fairly valued at these multiples.", "valuation"],
    ["We rate the shares overweight.", "recommendation"],
    ["The company is well-positioned as an investment.", "security_assessment"],
    ["Our price target is $52.", "price_target"],
    ["Margins outperform its peers by a wide margin.", "peer_comparison"],
    ["The quarter was strong across every line.", "verdict"],
  ];
  for (const [sentence, expectedCategory] of cases) {
    const r = filterComplianceLanguage(sentence);
    assert.equal(r.blocked, true, `not blocked: ${sentence}`);
    assert.equal(r.clean, "", `not fully stripped: ${sentence} -> "${r.clean}"`);
    assert.ok(
      r.findings.some((f) => f.category === expectedCategory),
      `wrong category for "${sentence}": got ${r.findings.map((f) => f.category).join(",")}`,
    );
  }
});

test("mixed text keeps descriptive sentences and drops the prohibited one", () => {
  const mixed =
    "Revenue grew 22 percent YoY to 1.2 billion. The stock looks undervalued at these multiples. Operating cash flow was 340 million.";
  const r = filterComplianceLanguage(mixed);
  assert.equal(r.blocked, true);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].category, "valuation");
  assert.ok(r.clean.includes("Revenue grew 22 percent"));
  assert.ok(r.clean.includes("Operating cash flow was 340 million"));
  assert.ok(!r.clean.toLowerCase().includes("undervalued"));
});

test("buy/sell/hold recommendations are caught", () => {
  for (const s of [
    "Investors should accumulate on any weakness.",
    "We would avoid the shares here.",
    "Hold the position through the print.",
    "A clear sell into strength.",
  ]) {
    const r = filterComplianceLanguage(s);
    assert.equal(r.clean, "", `not stripped: ${s}`);
    assert.equal(r.findings[0].category, "recommendation", `miscategorized: ${s}`);
  }
});

test("scanCompliance reports without mutating; matchProhibited classifies one sentence", () => {
  const findings = scanCompliance("Revenue was 10 million. The stock is cheap.");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].category, "valuation");

  assert.equal(matchProhibited("Revenue was 10 million."), null);
  assert.equal(matchProhibited("The valuation is attractive.")?.category, "valuation");
});

test("empty / whitespace input is a no-op, never throws", () => {
  for (const v of [undefined, null, "", "   "]) {
    const r = filterComplianceLanguage(v);
    assert.equal(r.clean, "");
    assert.equal(r.blocked, false);
    assert.equal(r.findings.length, 0);
  }
});

test("fully-prohibited input collapses to empty clean text", () => {
  const allBad =
    "The stock looks undervalued. This is a compelling buy. Our price target is $52.";
  const r = filterComplianceLanguage(allBad);
  assert.equal(r.clean, "");
  assert.equal(r.findings.length, 3);
});

/**
 * Unit tests for financials-commentary.ts. Pure, deterministic, no network.
 * Run: npx tsx --test src/lib/financials-commentary.test.ts
 *
 * Pins the XBRL-only input contract (no web pool), the descriptive-only prompt,
 * and the sanitizer.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assembleXbrlInput,
  buildCommentaryPrompt,
  sanitizeCommentary,
  commentarySourceHash,
  COMMENTARY_DISCLAIMER,
} from "./financials-commentary";
import type { CompanyFinancialsResult } from "./financial-facts";

function cell(value: number) {
  return { value, filingUrl: null, accession: null };
}

const SAMPLE: CompanyFinancialsResult = {
  cik: 123,
  annual: {
    periods: [
      { key: "FY-2024", label: "FY2024", fiscalYear: 2024, fiscalPeriod: "FY", periodEnd: "2024-12-31" },
      { key: "FY-2023", label: "FY2023", fiscalYear: 2023, fiscalPeriod: "FY", periodEnd: "2023-12-31" },
    ],
    grid: {
      revenue: { "FY-2024": cell(471_000_000), "FY-2023": cell(328_300_000) },
      operating_income: { "FY-2024": cell(12_400_000), "FY-2023": cell(-8_100_000) },
      eps_diluted: { "FY-2024": cell(0.12), "FY-2023": cell(-0.09) },
    },
  },
  quarterly: { periods: [], grid: {} },
  reportingCurrency: "USD",
};

test("assembleXbrlInput serializes ONLY the company's own figures and periods", () => {
  const block = assembleXbrlInput("Klaviyo", SAMPLE);
  assert.ok(block);
  assert.ok(block!.includes("Company: Klaviyo"));
  assert.ok(block!.includes("FY2024 | FY2023"));
  assert.ok(block!.includes("Revenue: 471,000,000 | 328,300,000"));
  assert.ok(block!.includes("Operating income: 12,400,000 | -8,100,000"));
  assert.ok(block!.includes("EPS (diluted): 0.12 | -0.09"));
  // No web / news / peer scaffolding leaks into the input.
  assert.ok(!/article|news|peer|competitor|web/i.test(block!));
});

test("assembleXbrlInput returns null when there is nothing to describe", () => {
  const empty: CompanyFinancialsResult = {
    cik: null,
    annual: { periods: [], grid: {} },
    quarterly: { periods: [], grid: {} },
    reportingCurrency: null,
  };
  assert.equal(assembleXbrlInput("Nobody", empty), null);
});

test("prompt pins the descriptive-only contract and carries only the XBRL block", () => {
  const block = assembleXbrlInput("Klaviyo", SAMPLE)!;
  const { system, user } = buildCommentaryPrompt(block);
  // Prohibitions are stated verbatim.
  for (const term of ["valuation", "buy, sell, hold", "peer or competitor", "price targets"]) {
    assert.ok(system.toLowerCase().includes(term.toLowerCase()), `missing prohibition: ${term}`);
  }
  assert.ok(system.includes("DESCRIPTIVE"));
  assert.ok(system.includes("ONLY source"));
  // The user message carries the XBRL and instructs plain text.
  assert.ok(user.includes("Revenue: 471,000,000"));
  assert.ok(user.includes("only source"));
});

test("sanitizeCommentary strips fences, quotes, and em-dashes; caps length", () => {
  assert.equal(sanitizeCommentary("```\nRevenue rose.\n```"), "Revenue rose.");
  assert.equal(sanitizeCommentary('"Revenue rose."'), "Revenue rose.");
  assert.ok(!sanitizeCommentary("Revenue rose \u2014 sharply.").includes("\u2014"));
  assert.equal(sanitizeCommentary(""), "");
  assert.equal(sanitizeCommentary(null), "");
});

test("source hash is stable and input-sensitive", () => {
  const a = assembleXbrlInput("Klaviyo", SAMPLE)!;
  assert.equal(commentarySourceHash(a), commentarySourceHash(a));
  assert.notEqual(commentarySourceHash(a), commentarySourceHash(a + " extra"));
});

test("disclaimer is present and self-describing", () => {
  assert.ok(/not investment advice/i.test(COMMENTARY_DISCLAIMER));
  assert.ok(/verify/i.test(COMMENTARY_DISCLAIMER));
});

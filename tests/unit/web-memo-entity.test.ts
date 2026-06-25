// Unit tests for the web-memo grounding guards (eval PR #415 fixes).
// Fixtures are trimmed from the real Exa pools used in docs/eval/webmemo-accuracy.md.
// Run: node --test tests/unit/web-memo-entity.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyWebResults,
  isThinPool,
  verifyMemoCitations,
  enforceMemoCitations,
  parseWebResultsFromContent,
  THIN_POOL_MIN_ON_ENTITY,
  type WebResultLike,
} from "../../src/lib/web-memo-entity.ts";

const r = (title: string, summary = "", source = "x.com"): WebResultLike => ({
  url: `https://${source}/x`,
  title,
  summary,
  source,
  publishedAt: "2026-06-20",
});

// The eval's Lake Shore Bancorp pool: 5 genuine LSBK rows + 3 other "Shore" banks.
const LSBK_POOL: WebResultLike[] = [
  r("Brautigam exercises options in Lake Shore Bancorp | LSBK Insider Trading"),
  r("WSFS Financial (NASDAQ:WSFS) & Lake Shore Bancorp (NASDAQ:LSBK) Financial Survey"),
  r("Lake Shore Bancorp: LSBK Stock Price Quote & News | Robinhood"),
  r("Financial Contrast: Lake Shore Bancorp (NASDAQ:LSBK) and WSFS Financial"),
  r("Old Second Bancorp, Inc. (OSBC) Stock", "Quote table also lists LSBK 15.77"),
  r("Shore Bancshares names B. Scot Ebron bank president | SHBI Stock News"),
  r("North Shore Bank buying PyraMax Bank owner for around $95 million"),
  r("Shore Bancshares, Inc. Announces Appointment of B. Scot Ebron"),
];

test("entity filter drops off-entity 'Shore' banks from a Lake Shore Bancorp pool", () => {
  const { onEntity, sectorContext } = classifyWebResults(
    { canonical: "Lake Shore Bancorp", ticker: "LSBK" },
    LSBK_POOL,
  );
  // The 3 contaminants (Shore Bancshares, North Shore Bank) must be dropped.
  assert.equal(sectorContext.length, 3);
  const droppedTitles = sectorContext.map((x) => x.title).join(" | ");
  assert.match(droppedTitles, /North Shore Bank buying PyraMax/);
  assert.match(droppedTitles, /Shore Bancshares/);
  // The $95M misattribution source is NOT in the subject material.
  assert.ok(!onEntity.some((x) => /\$95 million/.test(x.title)));
  // Every surviving row is genuinely Lake Shore Bancorp.
  assert.ok(onEntity.every((x) => /lake shore|lsbk/i.test(`${x.title} ${x.summary}`)));
});

test("entity filter keeps a clean single-token pool intact (no over-drop)", () => {
  const APPLE_POOL = [
    r("Apple Approves Samsung Display for iPhone Fold Production"),
    r("Apple introduces Siri AI"),
    r("A new unpatchable flaw in Apple chips"),
    r("Apple's design studio has lost nearly every Jony Ive-era designer"),
  ];
  const { onEntity, sectorContext } = classifyWebResults(
    { canonical: "Apple", ticker: "AAPL" },
    APPLE_POOL,
  );
  assert.equal(onEntity.length, 4);
  assert.equal(sectorContext.length, 0);
});

test("concatenated brand form (JPMorganChase) stays on-entity", () => {
  const { onEntity } = classifyWebResults(
    { canonical: "JPMorgan Chase", ticker: "JPM" },
    [
      r("JPMorganChase blocks Hong Kong staff from using Claude"),
      r("JPMorganChase Expands Security and Resiliency Initiative to Canada"),
      r("JPMorgan Posted Record Profits"),
    ],
  );
  assert.equal(onEntity.length, 3);
});

test("thin-pool gate: below threshold triggers, LSBK on-entity count does not", () => {
  assert.equal(THIN_POOL_MIN_ON_ENTITY, 4);
  assert.equal(isThinPool(3), true);
  assert.equal(isThinPool(1), true);
  assert.equal(isThinPool(4), false);
  const { onEntity } = classifyWebResults(
    { canonical: "Lake Shore Bancorp", ticker: "LSBK" },
    LSBK_POOL,
  );
  assert.equal(onEntity.length, 5); // 5 genuine LSBK rows survive the filter
});

test("citation check flags a figure absent from its cited result", () => {
  const pool = [
    r("North Shore Bank buying PyraMax Bank owner for around $95 million"), // [1]
    r("Lake Shore Bancorp LSBK insider option exercise of 1,028 shares"), // [2]
  ];
  // Sentence cites [2] but the $95 million belongs to [1].
  const bad = "Lake Shore Bancorp is acquiring a competitor for roughly $95 million [2].";
  const flags = verifyMemoCitations(bad, pool);
  assert.equal(flags.length, 1);
  assert.deepEqual(flags[0].citedIndices, [2]);
  assert.ok(flags[0].missingFigures.includes("95"));

  // Sentence whose figure IS in its cited result is not flagged.
  const good = "An insider exercised options on 1,028 shares [2].";
  assert.equal(verifyMemoCitations(good, pool).length, 0);
});

test("enforcement strips only the unsupported citation, keeps the sentence", () => {
  const pool = [
    r("North Shore Bank buying PyraMax Bank owner for around $95 million"), // [1]
    r("Lake Shore Bancorp LSBK insider option exercise of 1,028 shares"), // [2]
  ];
  const memo =
    "Lake Shore Bancorp is acquiring a competitor for roughly $95 million [2]. " +
    "An insider exercised options on 1,028 shares [2].";
  const fixed = enforceMemoCitations(memo, pool);
  // The $95M is not in [2] -> [2] stripped, but the sentence prose survives.
  assert.match(fixed, /acquiring a competitor for roughly \$95 million\./);
  assert.ok(!/\$95 million \[2\]/.test(fixed));
  // The 1,028-share figure IS in [2] -> that citation is untouched.
  assert.match(fixed, /1,028 shares \[2\]\./);
});

test("enforcement keeps a citation that supports one of several figures", () => {
  const pool = [
    r("Acme revenue rose to $52.8 million in Q1"), // [1] has 52.8
    r("Acme appoints a new COO"), // [2] has no figure
  ];
  const memo = "Acme revenue rose to $52.8 million [1][2].";
  const fixed = enforceMemoCitations(memo, pool);
  assert.match(fixed, /\$52\.8 million \[1\]\./); // [1] kept (supports 52.8)
  assert.ok(!/\[2\]/.test(fixed)); // [2] stripped (supports nothing)
});

test("parseWebResultsFromContent reads subject list, excludes SECTOR CONTEXT", () => {
  const content = [
    "COMPANY: Acme",
    "",
    "WEB SEARCH RESULTS (2):",
    "[1] Acme reports $10 million (a.com | 2026-06-01) http://a :: acme did things",
    "[2] Acme grows 20% (b.com) http://b :: acme grew",
    "",
    "SECTOR CONTEXT (different companies):",
    "[1] Gamma unrelated $999 (c.com) http://c :: gamma",
  ].join("\n");
  const parsed = parseWebResultsFromContent(content);
  assert.equal(parsed.length, 2);
  assert.match(parsed[0].title, /Acme reports \$10 million/);
  assert.ok(!parsed.some((p) => /Gamma/.test(p.title)));
});

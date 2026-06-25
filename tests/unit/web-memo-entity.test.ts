// Unit tests for the web-memo grounding guards (eval PR #415 fixes).
// Fixtures are trimmed from the real Exa pools used in docs/eval/webmemo-accuracy.md.
// Run: node --test tests/unit/web-memo-entity.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyWebResults,
  isThinPool,
  subjectForClassification,
  enforceCorroboratedFigures,
  verifyMemoCitations,
  enforceMemoCitations,
  parseWebResultsFromContent,
  THIN_POOL_MIN_ON_ENTITY,
  type WebResultLike,
} from "../../src/lib/web-memo-entity.ts";
import { normalizeFromResults } from "../../src/app/api/companies/web-fallback/normalize.ts";

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
  // The 3 Shore contaminants plus the OSBC quote-table row (ticker only in a
  // foreign body listing, not its title) must be dropped: 4 off-entity.
  assert.equal(sectorContext.length, 4);
  const droppedTitles = sectorContext.map((x) => x.title).join(" | ");
  assert.match(droppedTitles, /North Shore Bank buying PyraMax/);
  assert.match(droppedTitles, /Shore Bancshares/);
  assert.match(droppedTitles, /Old Second Bancorp/);
  // The $95M misattribution source is NOT in the subject material.
  assert.ok(!onEntity.some((x) => /\$95 million/.test(x.title)));
  // Every surviving row names Lake Shore Bancorp in its title.
  assert.ok(onEntity.every((x) => /lake shore/i.test(x.title)));
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
  // 4 rows name Lake Shore Bancorp in their title; the OSBC quote-table row is
  // excluded. 4 is at the threshold, so this fixture is not thin. A pool with
  // fewer genuine rows trips the gate (see the thin production-pool test below).
  assert.equal(onEntity.length, 4);
  assert.equal(isThinPool(onEntity.length), false);
});

test("thin-pool gate trips on a production-shaped LSBK pool (genuine coverage < 4)", () => {
  // The real failure: a name-ambiguous ticker whose pool is mostly other Shore
  // banks with only a couple of genuine Lake Shore Bancorp rows. After the
  // filter, on-entity < 4, so the route returns thin and no confident brief.
  const THIN_LSBK: WebResultLike[] = [
    r("Lake Shore Bancorp declares quarterly dividend | LSBK"),
    r("Lake Shore Bancorp Q1 results | LSBK Stock"),
    r("Shore Bancshares names B. Scot Ebron bank president | SHBI"),
    r("North Shore Bank buying PyraMax Bank owner for around $95 million"),
    r("Shore United Bank expands Greenlight partnership"),
    r("Shore Bancshares completes Jack Henry core conversion"),
  ];
  const { onEntity, sectorContext } = classifyWebResults(
    { canonical: "Lake Shore Bancorp", ticker: "LSBK" },
    THIN_LSBK,
  );
  assert.equal(onEntity.length, 2);
  assert.equal(sectorContext.length, 4); // all Shore/North Shore contaminants dropped
  assert.equal(isThinPool(onEntity.length), true); // gate trips: no confident brief
});

test("subjectForClassification falls back to the full query name on a token-collapsed pool", () => {
  // The live LSBK bug: normalizeFromResults collapses the contaminated pool to
  // the bare shared token "Shore"; classification must anchor on the fuller
  // query-derived name instead.
  assert.equal(subjectForClassification("Shore", "Lake Shore Bancorp"), "Lake Shore Bancorp");
  // Distinctive pool names are kept (typo recovery + concatenated brands).
  assert.equal(subjectForClassification("Pershing Square", "Perishing Square"), "Pershing Square");
  assert.equal(subjectForClassification("NVIDIA", "nvidia"), "NVIDIA");
  // Genuine single-token companies are not over-corrected.
  assert.equal(subjectForClassification("Apple", "Apple"), "Apple");
  assert.equal(subjectForClassification("Unum", "Unum"), "Unum");
});

test("live path: token-collapsed canonical no longer inverts the LSBK filter", () => {
  // Reproduces the deployed sequence: derive canonical from the pool, then pick
  // the classification subject, then filter. Before the fix this kept all 8.
  const query = "Lake Shore Bancorp";
  const derived = normalizeFromResults(query, LSBK_POOL as never, query);
  assert.equal(derived, "Shore"); // the root-cause collapse is still observable
  const subject = subjectForClassification(derived, query);
  const { onEntity, sectorContext } = classifyWebResults(
    { canonical: subject, ticker: "LSBK" },
    LSBK_POOL,
  );
  // The Shore contaminants and the OSBC quote-table row are dropped.
  assert.equal(sectorContext.length, 4);
  assert.ok(!onEntity.some((x) => /\$95 million|Shore Bancshares/.test(x.title)));
  // Only genuine LSBK rows (named in title) survive.
  assert.ok(onEntity.every((x) => /lake shore/i.test(x.title)));
});

test("corroboration guard strips a single-source figure citation", () => {
  const pool = [
    r("Unum reports Q1 2026 revenue of $3.18 billion, a beat"), // [1]
    r("Unum names a new CFO"), // [2] no figure
  ];
  // The false figure appears in zero/one source -> citation stripped, prose kept.
  const memo = "Unum Q1 2026 revenue fell 11.3% to $2.93 billion, missing by 5.2% [1].";
  const fixed = enforceCorroboratedFigures(memo, pool);
  assert.ok(!/\[1\]/.test(fixed));
  assert.match(fixed, /\$2\.93 billion/); // prose survives, just de-authorized
});

test("corroboration guard rejects an order-of-magnitude mismatch", () => {
  const pool = [
    r("Acme Q1 revenue was $2.93 million"), // [1] million
    r("Acme Q1 revenue was $2.93 million per the filing"), // [2] million
  ];
  // Memo claims billions; two sources say millions -> same digits, wrong scale.
  const memo = "Acme posted $2.93 billion in Q1 revenue [1][2].";
  const fixed = enforceCorroboratedFigures(memo, pool);
  assert.ok(!/\[1\]/.test(fixed) && !/\[2\]/.test(fixed));
});

test("corroboration guard keeps a figure backed by two compatible sources", () => {
  const pool = [
    r("Acme Q1 revenue rose to $2.93 billion"), // [1]
    r("Acme reported $2.93 billion for the quarter"), // [2]
  ];
  const memo = "Acme posted $2.93 billion in Q1 revenue [1][2].";
  const fixed = enforceCorroboratedFigures(memo, pool);
  assert.equal(fixed, memo); // corroborated by two compatible sources, untouched
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

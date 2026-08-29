// Unit tests for the three Company Intel mobile mappers this unit owns:
// buildMasthead, buildKpis and buildPrimer in src/lib/company-mobile/build.ts.
//
// WHY UNIT AND NOT E2E. `/company/[id]` is a SERVER component. It has no
// "use client" and it awaits Supabase directly, so its reads never cross the
// browser boundary and `page.route()` cannot see, stub or fault a single one of
// them. A Playwright spec can prove what a signed-in reader SEES on one real
// company; it cannot prove what these functions DECIDE for a company whose rows
// are shaped some other way. This file feeds them `CompanyDetail` objects built
// to order and asserts the mapped output, which is the deterministic proof
// CLAUDE.md's preflight rule accepts in place of e2e for a data-access change.
//
// THE CONTRACT LOCKED HERE:
//
//   no ticker            -> "" and never a dash, the slug or the display name
//   no sector            -> no identity row and no masthead sector, not "n/a"
//   no articles          -> NO sources cell and NO tone cell, rather than cells
//                           carrying an empty value
//   tone insufficient    -> NO tone cell, because "not enough coverage to state
//                           a level" is not a level
//   mentions             -> attention.currentCount over a 7-day label, never
//                           the all-time sum and never a 30-day label
//   no COMPANY_IDENTITY  -> no industry row and an empty overview
//   no filed period      -> no key figure at all, not four dashes
//   every mapper         -> makes no network call of any kind
//
// The sparse case is `/company/mistral-ai`, measured: no ticker, no CIK, zero
// articles in the 14-day window, zero mentions in 7 days and zero prior, and no
// curated identity entry. If anything invented reaches the screen it reaches it
// there first.
//
// Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildKpis, buildMasthead, buildPrimer } from "../../src/lib/company-mobile/build.ts";
import { computeAttention } from "../../src/lib/attention.ts";
import { computeTone, formatEvidence, type SentimentLabel } from "../../src/lib/tone.ts";
import type { CompanyDetail, CompanyDetailArticle } from "../../src/lib/data-access/getCompanyDetail.ts";
import type { CompanyArticle, CompanyIdentity } from "../../src/lib/company-intel.ts";
import type { CompanyFinancialsResult } from "../../src/lib/financial-facts.ts";

/**
 * The character itself, written as an escape.
 *
 * These assertions exist to prove no mapper emits an em dash, and a literal one
 * in the assertion is still an em dash in the repo, which scripts/design-lint.mjs
 * rejects on sight and is right to.
 */
const EM_DASH = "\u2014";

/* ── builders ────────────────────────────────────────────────────────── */

function article(over: Partial<CompanyDetailArticle> = {}): CompanyDetailArticle {
  return {
    id: "a1",
    title: "Headline",
    source: "Reuters",
    url: null,
    publishedAt: "2026-08-20T00:00:00Z",
    sentiment: "neutral",
    dealType: null,
    relevanceScore: null,
    sector: "Semiconductors",
    summary: null,
    relevanceReason: null,
    sentimentReason: null,
    ingestedAt: null,
    sourceWinRate: null,
    sourceSampleSize: null,
    completeness: "summary",
    ...over,
  };
}

function detail(over: Partial<CompanyDetail> = {}): CompanyDetail {
  return {
    canonical: "Broadcom",
    display: "Broadcom",
    ticker: "AVGO",
    exchange: null,
    sector: "Semiconductors",
    // Poison. `getCompanyDetail` hardcodes this to null, so nothing may read it;
    // a mapper that does will put this string on a real company's screen.
    industry: "READ-FROM-THE-WRONG-PLACE",
    aliases: [],
    aliasMentions: [],
    mentions: 4211,
    mentions7d: [1, 2, 3, 4, 5, 6, 7, 8],
    sentiment7d: [0, 0, 0, 0, 0, 0, 0, 0],
    tone: computeTone([], []),
    attention: computeAttention(0, 0),
    articles: [],
    themes: [],
    memo: null,
    isPrivate: false,
    ...over,
  };
}

function labels(sentiments: SentimentLabel[]): SentimentLabel[] {
  return sentiments;
}

const EMPTY_FINANCIALS: CompanyFinancialsResult = {
  cik: null,
  annual: { periods: [], grid: {} },
  quarterly: { periods: [], grid: {} },
  reportingCurrency: null,
};

function financials(over: Partial<CompanyFinancialsResult> = {}): CompanyFinancialsResult {
  return { ...EMPTY_FINANCIALS, ...over };
}

function development(over: Partial<CompanyArticle> = {}): CompanyArticle {
  return { id: "d1", title: "A development", _isDevelopment: true, ...over };
}

/* ── the sparse company, which is the one that matters ───────────────── */

// Measured on /company/mistral-ai: ticker null, sec_cik null, zero articles in
// the 14-day window, zero mentions in 7 days and zero in the prior 7, and no
// COMPANY_IDENTITY entry. Therefore no sector either, since sector is the modal
// sector of those articles.
const SPARSE = detail({
  canonical: "Mistral AI",
  display: "Mistral AI",
  ticker: null,
  sector: null,
  mentions: 0,
  mentions7d: [0, 0, 0, 0, 0, 0, 0, 0],
  tone: computeTone([], []),
  attention: computeAttention(0, 0),
  articles: [],
});

test("sparse company: masthead states the name and nothing else", () => {
  const m = buildMasthead(SPARSE);
  assert.equal(m.name, "Mistral AI");
  assert.equal(m.ticker, "");
  assert.equal(m.sector, "");
  // Never a stand-in a reader could mistake for a symbol.
  assert.notEqual(m.ticker, "-");
  assert.notEqual(m.ticker, EM_DASH);
  assert.notEqual(m.ticker, "n/a");
  assert.notEqual(m.ticker, m.name);
  assert.notEqual(m.ticker, "mistral-ai");
  assert.equal(m.memoCorpus, "0 ARTICLES");
});

test("sparse company: exactly one KPI cell, and no cell carries an empty value", () => {
  const cells = buildKpis(SPARSE);
  assert.equal(cells.length, 1);
  assert.deepEqual(cells[0], { label: "MENTIONS · 7D", value: "0" });
  assert.equal(cells.some((c) => c.label === "SOURCES"), false);
  assert.equal(cells.some((c) => c.label === "ARTICLE TONE"), false);
  for (const c of cells) {
    assert.ok(c.label.length > 0);
    assert.ok(c.value.length > 0);
    assert.notEqual(c.value, EM_DASH);
    assert.notEqual(c.value, "n/a");
  }
});

test("sparse company: no identity row, no key figure, no development, no overview", () => {
  const p = buildPrimer(SPARSE, null, [], EMPTY_FINANCIALS);
  assert.deepEqual(p.identity, []);
  assert.deepEqual(p.keyFigures, []);
  assert.deepEqual(p.developments, []);
  assert.equal(p.overview, "");
  // The two strings that are always there are about this file, not about the
  // company and not about the reader.
  assert.ok(p.lede.length > 0);
  assert.ok(p.footnote.length > 0);
  assert.equal(/\byou\b|\byour\b/i.test(p.lede), false);
  assert.equal(/\byou\b|\byour\b/i.test(p.footnote), false);
});

/* ── the full company ────────────────────────────────────────────────── */

const FULL_ARTICLES: CompanyDetailArticle[] = [
  article({ id: "1", source: "Reuters" }),
  article({ id: "2", source: "Bloomberg" }),
  article({ id: "3", source: "Reuters" }),
  article({ id: "4", source: null }),
  article({ id: "5", source: "   " }),
];

const FULL = detail({
  articles: FULL_ARTICLES,
  attention: computeAttention(31, 60),
  tone: computeTone(
    labels(["bullish", "bullish", "bullish", "neutral", "bearish"]),
    labels(["neutral", "neutral", "neutral", "neutral", "neutral"]),
  ),
});

test("full company: masthead copies the row and counts the corpus", () => {
  const m = buildMasthead(FULL);
  assert.equal(m.ticker, "AVGO");
  assert.equal(m.sector, "Semiconductors");
  assert.equal(m.name, "Broadcom");
  assert.equal(m.memoCorpus, "5 ARTICLES");
});

test("memoCorpus is a count with a unit word, and it agrees on one", () => {
  assert.equal(buildMasthead(detail({ articles: [article()] })).memoCorpus, "1 ARTICLE");
  assert.equal(buildMasthead(detail({ articles: [] })).memoCorpus, "0 ARTICLES");
  // A count is never a rate. No percent sign, no "of", no ratio.
  for (const d of [SPARSE, FULL]) {
    const corpus = buildMasthead(d).memoCorpus;
    assert.equal(corpus.includes("%"), false);
    assert.equal(corpus.includes("/"), false);
  }
});

test("mentions reads attention.currentCount over a 7-day label", () => {
  const cells = buildKpis(FULL);
  const mentions = cells.find((c) => c.label.startsWith("MENTIONS"));
  assert.ok(mentions);
  // The label names the window that was actually measured. A 30-day label over
  // a 7-day number is the exact defect this sprint removes.
  assert.equal(mentions.label, "MENTIONS · 7D");
  assert.equal(mentions.label.includes("30"), false);
  assert.equal(mentions.value, "31");
  // Not the all-time sum (4211) and not the sum of the eight daily slots (36).
  assert.notEqual(mentions.value, String(FULL.mentions));
  assert.notEqual(mentions.value, String(FULL.mentions7d.reduce((a, b) => a + b, 0)));
  assert.equal(mentions.meta, undefined);
});

test("sources counts distinct non-empty publishers and carries no meta line", () => {
  const cells = buildKpis(FULL);
  const sources = cells.find((c) => c.label === "SOURCES");
  assert.ok(sources);
  // Reuters, Bloomberg. The null and the blank are not publishers.
  assert.equal(sources.value, "2");
  // The design's "primary + tier-1" has no source on this path.
  assert.equal(sources.meta, undefined);
  assert.equal(sources.tone, undefined);
});

test("tone cell carries the closed label, the evidence line and a read tint", () => {
  const cells = buildKpis(FULL);
  const tone = cells.find((c) => c.label === "ARTICLE TONE");
  assert.ok(tone);
  assert.equal(tone.value, FULL.tone.levelLabel);
  // Same helper the tone section uses, so the cell and the body cannot drift.
  assert.equal(tone.meta, formatEvidence(FULL.tone.evidence));
  assert.equal(tone.tone, "up");
  assert.equal(["Strongly Positive", "Positive", "Mixed", "Negative", "Strongly Negative"].includes(tone.value), true);
});

test("a negative reading is tinted down and a mixed one flat, never pinned", () => {
  const bearish = detail({
    articles: FULL_ARTICLES,
    tone: computeTone(labels(["bearish", "bearish", "bearish", "bearish"]), []),
  });
  const mixed = detail({
    articles: FULL_ARTICLES,
    tone: computeTone(labels(["bullish", "bearish", "neutral", "neutral"]), []),
  });
  assert.equal(buildKpis(bearish).find((c) => c.label === "ARTICLE TONE")?.tone, "down");
  assert.equal(buildKpis(mixed).find((c) => c.label === "ARTICLE TONE")?.tone, "flat");
});

/* ── the insufficient-tone company ───────────────────────────────────── */

// Measured on /company/quantinuum: zero mentions in the current 7-day window
// and 14 in the prior one, so the level is not stateable and the direction is
// suppressed, while the article list still carries publishers to count.
test("tone insufficient: the cell is omitted rather than emptied", () => {
  const quantinuum = detail({
    canonical: "Quantinuum",
    display: "Quantinuum",
    ticker: null,
    articles: FULL_ARTICLES,
    attention: computeAttention(0, 14),
    tone: computeTone([], labels(["neutral", "neutral", "neutral", "neutral", "neutral"])),
  });
  assert.equal(quantinuum.tone.sufficient, false);
  const cells = buildKpis(quantinuum);
  assert.equal(cells.some((c) => c.label === "ARTICLE TONE"), false);
  assert.deepEqual(cells.map((c) => c.label), ["MENTIONS · 7D", "SOURCES"]);
  for (const c of cells) assert.ok(c.value.length > 0);
});

/* ── the primer ──────────────────────────────────────────────────────── */

const IDENTITY: CompanyIdentity = {
  industry: "Semiconductors",
  brief: "Broadcom designs semiconductors and infrastructure software.",
};

test("identity rows are sector and industry only, and industry is the curated one", () => {
  const p = buildPrimer(FULL, IDENTITY, [], EMPTY_FINANCIALS);
  assert.deepEqual(p.identity, [
    { label: "Sector", value: "Semiconductors" },
    { label: "Industry", value: "Semiconductors" },
  ]);
  // detail.industry is a hardcoded null literal upstream. Nothing may read it.
  assert.equal(JSON.stringify(p).includes("READ-FROM-THE-WRONG-PLACE"), false);
  // No third row. There is no headquarters column on any table.
  assert.equal(p.identity.some((r) => /headquarters/i.test(r.label)), false);
});

test("no curated entry means no industry row and no overview", () => {
  const p = buildPrimer(FULL, null, [], EMPTY_FINANCIALS);
  assert.deepEqual(p.identity, [{ label: "Sector", value: "Semiconductors" }]);
  assert.equal(p.overview, "");
});

test("overview is the curated brief verbatim", () => {
  const p = buildPrimer(FULL, IDENTITY, [], EMPTY_FINANCIALS);
  assert.equal(p.overview, IDENTITY.brief);
});

test("developments are the classified rows, summary first and title as the fallback", () => {
  const p = buildPrimer(
    FULL,
    null,
    [
      development({ id: "1", title: "Title one", summary: "Summary one." }),
      development({ id: "2", title: "Title two" }),
      development({ id: "3", title: "Title three", summary: "   " }),
      development({ id: "4", title: "   " }),
    ],
    EMPTY_FINANCIALS,
  );
  assert.deepEqual(p.developments, ["Summary one.", "Title two", "Title three"]);
});

/* ── key figures ─────────────────────────────────────────────────────── */

function view(periodKey: string, periodLabel: string, cells: Record<string, number>) {
  const grid: Record<string, Record<string, { value: number; filingUrl: null; accession: null }>> = {};
  for (const [metric, value] of Object.entries(cells)) {
    grid[metric] = { [periodKey]: { value, filingUrl: null, accession: null } };
  }
  return {
    periods: [
      {
        key: periodKey,
        label: periodLabel,
        fiscalYear: 2025,
        fiscalPeriod: periodKey.startsWith("FY") ? "FY" : "Q2",
        periodEnd: "2025-11-02",
      },
    ],
    grid,
  };
}

test("key figures come off the newest annual period and name it", () => {
  const p = buildPrimer(
    FULL,
    IDENTITY,
    [],
    financials({
      cik: 1730168,
      reportingCurrency: "USD",
      annual: view("FY-2025", "FY2025", { revenue: 51_574_000_000, net_income: 5_895_000_000 }),
    }),
  );
  assert.deepEqual(p.keyFigures, [
    { label: "REVENUE · FY2025", value: "$51.57B", scale: "figure" },
    { label: "NET INCOME · FY2025", value: "$5.89B", scale: "figure" },
  ]);
});

test("a filer with only a quarterly basis still draws its own period", () => {
  const p = buildPrimer(
    FULL,
    null,
    [],
    financials({
      cik: 937966,
      reportingCurrency: "EUR",
      quarterly: view("Q2-2026", "Q2 FY2026", { revenue: 7_742_000_000 }),
    }),
  );
  // One figure, not two padded with a dash under a fact that was not filed.
  assert.equal(p.keyFigures.length, 1);
  assert.equal(p.keyFigures[0].label, "REVENUE · Q2 FY2026");
  // Never a bare dollar sign on a filer that reported in another currency.
  assert.equal(p.keyFigures[0].value.includes("$"), false);
  assert.ok(p.keyFigures[0].value.startsWith("EUR "));
});

test("a company with no filed period draws no figure at all", () => {
  const p = buildPrimer(FULL, IDENTITY, [], EMPTY_FINANCIALS);
  assert.deepEqual(p.keyFigures, []);
});

test("the design's four figures are not producible and none of them appears", () => {
  const p = buildPrimer(
    FULL,
    IDENTITY,
    [development({ id: "1", title: "A development" })],
    financials({
      cik: 1730168,
      reportingCurrency: "USD",
      annual: view("FY-2025", "FY2025", { revenue: 51_574_000_000, net_income: 5_895_000_000 }),
    }),
  );
  const serialized = JSON.stringify(p).toUpperCase();
  for (const banned of ["EBITDA", "P / E", "52-WEEK", "CAPACITY", "HEADQUARTER"]) {
    assert.equal(serialized.includes(banned), false, `${banned} has no source and must not appear`);
  }
  // No figure ever renders the "n/a" formatMoney gives back for a missing value.
  for (const f of p.keyFigures) assert.notEqual(f.value, "n/a");
});

/* ── the hard line ───────────────────────────────────────────────────── */

test("no mapper makes a network call", async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => {
    calls += 1;
    throw new Error("a mapper reached the network");
  }) as typeof fetch;
  try {
    buildMasthead(FULL);
    buildKpis(FULL);
    buildPrimer(
      FULL,
      IDENTITY,
      [development({ id: "1", title: "A development" })],
      financials({
        cik: 1730168,
        reportingCurrency: "USD",
        annual: view("FY-2025", "FY2025", { revenue: 1, net_income: 2 }),
      }),
    );
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(calls, 0);
});

test("nothing a mapper emits carries an em dash", () => {
  const out = JSON.stringify([
    buildMasthead(FULL),
    buildKpis(FULL),
    buildPrimer(FULL, IDENTITY, [development({ id: "1", title: "A development" })], EMPTY_FINANCIALS),
    buildMasthead(SPARSE),
    buildKpis(SPARSE),
    buildPrimer(SPARSE, null, [], EMPTY_FINANCIALS),
  ]);
  assert.equal(out.includes(EM_DASH), false);
});

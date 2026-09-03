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
import type { CompanyDescriptionRow } from "../../src/lib/company-identity.ts";

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
    companyId: "00000000-0000-4000-8000-000000000001",
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
    descriptionRow: null,
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
    readFailed: false,
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
  assert.equal(p.overview, null);
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

test("sources counts PUBLISHERS, not the publisher-plus-query column", () => {
  /* `articles.source` is not a publisher column. The Google News ingest writes
     one string per feed it polled, so one aggregator arrives as many strings:
     measured over 1,000 rows, 411 distinct values of which 377 are
     `Google News (TICKER)` variants. Counting the column raw printed SOURCES 27
     for Goldman Sachs against 10 real publishers, beside a cell reading
     `MENTIONS · 7D 20`, which is both inflated and arithmetically impossible.

     The strings below are the real shape, copied off the column. */
  const feeds = detail({
    articles: [
      article({ id: "1", source: "Google News (GS)" }),
      article({ id: "2", source: "Google News (AVGO)" }),
      article({ id: "3", source: "Google News (CRM)" }),
      article({ id: "4", source: "Google News" }),
      article({ id: "5", source: "Reuters" }),
      article({ id: "6", source: "Reuters" }),
      article({ id: "7", source: "Bloomberg" }),
    ],
  });
  const sources = buildKpis(feeds).find((c) => c.label === "SOURCES");
  assert.ok(sources);
  // Google News, Reuters, Bloomberg. Not five, and not seven.
  assert.equal(sources.value, "3");
});

test("sources never prints more publishers than the mentions cell beside it", () => {
  /* The two cells sit side by side, so "20 articles from 27 sources" is a pair
     a reader can see is wrong without leaving the screen. Measured shape:
     Goldman Sachs, 20 mentions in 7 days, 17 Google News ticker feeds and 10
     real publishers in the article list. */
  const gs = detail({
    attention: computeAttention(20, 40),
    articles: [
      ...Array.from({ length: 17 }, (_, i) =>
        article({ id: `feed-${i}`, source: `Google News (TICK${i})` }),
      ),
      ...["Reuters", "Bloomberg", "CNBC", "WSJ", "FT", "Barron's", "Yahoo Finance", "MarketWatch", "Investing.com", "Seeking Alpha"].map(
        (name, i) => article({ id: `pub-${i}`, source: name }),
      ),
    ],
  });
  const cells = buildKpis(gs);
  const mentions = cells.find((c) => c.label === "MENTIONS · 7D");
  const sources = cells.find((c) => c.label === "SOURCES");
  assert.ok(mentions && sources);
  assert.equal(sources.value, "11");
  assert.ok(
    Number(sources.value) <= Number(mentions.value),
    `SOURCES ${sources.value} exceeds MENTIONS ${mentions.value}`,
  );
});

test("a parenthetical that is the whole string is not a publisher", () => {
  const odd = detail({
    articles: [article({ id: "1", source: "(AVGO)" }), article({ id: "2", source: "Reuters" })],
  });
  const sources = buildKpis(odd).find((c) => c.label === "SOURCES");
  assert.ok(sources);
  assert.equal(sources.value, "1");
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
  assert.equal(p.overview, null);
});

test("overview is the curated brief verbatim", () => {
  const p = buildPrimer(FULL, IDENTITY, [], EMPTY_FINANCIALS);
  assert.equal(p.overview?.source, "curated");
  assert.equal(p.overview?.text, IDENTITY.brief);
});

/* the licensed branch, on the surface that used to widen it to a bare string */

const WIKI_PARA =
  "Cinven Limited is a global private equity firm founded in 1977, with offices " +
  "in nine international locations.";

function wikiRow(over: Partial<CompanyDescriptionRow> = {}): CompanyDescriptionRow {
  return {
    description: WIKI_PARA,
    description_source: "wikipedia",
    description_source_url: "https://en.wikipedia.org/wiki/Cinven",
    description_source_title: "Cinven",
    description_license: "CC BY-SA 4.0",
    description_license_url: "https://creativecommons.org/licenses/by-sa/4.0/",
    ...over,
  };
}

test("a stored Wikipedia paragraph reaches the mobile primer whole and attributed", () => {
  const p = buildPrimer(detail({ descriptionRow: wikiRow() }), null, [], EMPTY_FINANCIALS);
  assert.equal(p.overview?.source, "wikipedia");
  assert.equal(p.overview?.text, WIKI_PARA);
  assert.equal(p.overview?.text.length, WIKI_PARA.length);
  assert.equal(p.overview?.normalizable, false);
  assert.equal(
    p.overview?.source === "wikipedia" ? p.overview.attribution.articleUrl : null,
    "https://en.wikipedia.org/wiki/Cinven",
  );
});

test("the curated brief still outranks the stored paragraph on mobile", () => {
  const p = buildPrimer(detail({ descriptionRow: wikiRow() }), IDENTITY, [], EMPTY_FINANCIALS);
  assert.equal(p.overview?.source, "curated");
  assert.equal(p.overview?.text, IDENTITY.brief);
});

test("a Wikipedia row with broken provenance hides the block rather than laundering it", () => {
  // THE LAUNDERING PATH. This used to come back as a bare `overview` string
  // with `overviewAttribution: null`: the same licensed prose, rendered with no
  // link to the article or the licence, and marked trimmable.
  for (const broken of [
    wikiRow({ description_source_url: null }),
    wikiRow({ description_source_title: null }),
    wikiRow({ description: WIKI_PARA.slice(0, 60) + "..." }),
    wikiRow({ description: "  " + WIKI_PARA }),
  ]) {
    const p = buildPrimer(detail({ descriptionRow: broken }), null, [], EMPTY_FINANCIALS);
    assert.equal(p.overview, null);
  }
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
    readFailed: false,
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
    readFailed: false,
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

test("the grid fills its row from whichever facts the filer reported", () => {
  // Measured: Broadcom's newest annual column carries revenue and no net_income.
  // Two facts are still two facts, so the two-column grid still fills a row.
  const p = buildPrimer(
    FULL,
    IDENTITY,
    [],
    financials({
      cik: 1730168,
      reportingCurrency: "USD",
    readFailed: false,
      annual: view("FY-2025", "FY2025", {
        revenue: 63_890_000_000,
        operating_income: 15_000_000_000,
        gross_profit: 40_000_000_000,
      }),
    }),
  );
  assert.deepEqual(p.keyFigures.map((f) => f.label), [
    "REVENUE · FY2025",
    "OPERATING INCOME · FY2025",
  ]);
});

test("the grid never draws more than the two the contract names", () => {
  const p = buildPrimer(
    FULL,
    IDENTITY,
    [],
    financials({
      cik: 1730168,
      reportingCurrency: "USD",
    readFailed: false,
      annual: view("FY-2025", "FY2025", {
        revenue: 1,
        net_income: 2,
        operating_income: 3,
        gross_profit: 4,
      }),
    }),
  );
  assert.equal(p.keyFigures.length, 2);
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
    readFailed: false,
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
    readFailed: false,
        annual: view("FY-2025", "FY2025", { revenue: 1, net_income: 2 }),
      }),
    );
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(calls, 0);
});

test("no string a mapper AUTHORS carries an em dash", () => {
  // Scoped to the strings this file writes: labels, the lede and the footnote.
  // A development line is a publisher's own headline or the ingest's own
  // summary read verbatim off a row, and rewriting a source string to satisfy a
  // house rule about prose would be editing the evidence.
  const authored: string[] = [];
  for (const d of [FULL, SPARSE]) {
    const m = buildMasthead(d);
    authored.push(m.memoCorpus);
    for (const c of buildKpis(d)) {
      authored.push(c.label, c.value, c.meta ?? "");
    }
    const p = buildPrimer(
      d,
      IDENTITY,
      [],
      financials({
        cik: 1730168,
        reportingCurrency: "USD",
    readFailed: false,
        annual: view("FY-2025", "FY2025", { revenue: 1_000_000, net_income: 2_000_000 }),
      }),
    );
    authored.push(p.lede, p.footnote);
    for (const r of p.identity) authored.push(r.label);
    for (const f of p.keyFigures) authored.push(f.label, f.value);
  }
  for (const line of authored) assert.equal(line.includes(EM_DASH), false, line);
});

/* ── the key-figures empty state, which needs a third answer ─────────── */

test("hasFiledPeriod is false for a company with no filed period at all", () => {
  const p = buildPrimer(SPARSE, null, [], EMPTY_FINANCIALS);
  assert.deepEqual(p.keyFigures, []);
  assert.equal(p.hasFiledPeriod, false);
});

test("hasFiledPeriod is TRUE with an empty key-figures list: the GRAB case", () => {
  /* GRAB, cik 1855612. Its single validated fact in the whole view is
     `cost_of_revenue` for FY2022, which is not one of the four keys the primer
     names, so `keyFigures` is [] while the Financials section on the SAME
     screen draws "FY2022 / INCOME STATEMENT / Cost of revenue $68.0M". Without
     this flag the section drew "Financials appear after the first periodic
     report" over a company whose periodic report is on file. */
  const p = buildPrimer(
    FULL,
    null,
    [],
    financials({
      cik: 1855612,
      reportingCurrency: "USD",
    readFailed: false,
      annual: view("FY-2022", "FY2022", { cost_of_revenue: 68_000_000 }),
    }),
  );
  assert.deepEqual(p.keyFigures, []);
  assert.equal(p.hasFiledPeriod, true);
});

test("hasFiledPeriod reads the period, not the key list, when both are there", () => {
  const p = buildPrimer(
    FULL,
    IDENTITY,
    [],
    financials({
      cik: 1730168,
      reportingCurrency: "USD",
    readFailed: false,
      annual: view("FY-2025", "FY2025", { revenue: 51_574_000_000 }),
    }),
  );
  assert.equal(p.keyFigures.length, 1);
  assert.equal(p.hasFiledPeriod, true);
});

/**
 * The two earnings cells in the Coverage Primer's key-stats grid.
 *
 * WHY A RENDER TEST AND NOT A FORMATTER TEST. The formatters are local to the
 * component and the thing under test is not "does a date format", it is "does
 * the grid draw a cell". A test that imported two exported formatters would
 * stay green with both `push` calls deleted, which is the incidental-fingerprint
 * shape CLAUDE.md's Learnings section names. Rendering to static markup and
 * reading the assembled DOM asserts the seam: the cell either reaches the
 * reader or it does not. It is the pattern src/lib/claim-card.test.ts and
 * tests/unit/reader-output-honesty.test.ts already use here.
 *
 * THE LOAD-BEARING ONE is the estimated-date pair. `calendarEvents.earnings
 * .earningsDate` is Yahoo's estimate until a filer confirms, and
 * quoteSummary.ts:116 takes element [0] of it unconditionally. So on a company
 * still carrying a window this cell draws the EARLIEST day of that window. Two
 * tests below pin that the drawn day is the first element and that neither the
 * label nor the note ever calls it confirmed.
 *
 * Run: npm run test:unit
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PrimerKeyStats } from "@/components/company/tabs/primer/PrimerKeyStats";
import type { QuoteSummaryLive } from "@/lib/yahoo/quoteSummary";

/**
 * AAPL as the live v10 route answered on 2026-09-04, trimmed to the fields the
 * grid reads. Real values, so a scale error in a formatter shows up as a wrong
 * number rather than a passing fiction.
 *   earningsDate[0].raw   1793304000  (Yahoo fmt "2026-10-29")
 *   surprisePercent.raw   0.0674      (Yahoo fmt "6.74%")
 */
const AAPL: QuoteSummaryLive = {
  kind: "live",
  ticker: "AAPL",
  last: 232.14,
  change: 0.0031,
  marketCap: 3.44e12,
  float: 1.48e10,
  peTrailing: 35.2,
  peForward: 30.1,
  epsTrailing: 6.59,
  epsForward: 7.71,
  fiftyTwoWeekHigh: 260.1,
  fiftyTwoWeekLow: 169.21,
  dividendYield: 0.0043,
  beta: 1.09,
  volume: 41_000_000,
  averageVolume: 55_000_000,
  targetMeanPrice: 245.5,
  industry: "Consumer Electronics",
  businessSummary: null,
  nextEarningsDate: 1793304000,
  lastEarnings: { actualEPS: 2.02, estimateEPS: 1.89243, surprisePct: 0.0674 },
};

function markup(quote: QuoteSummaryLive | null, loading = false): string {
  return renderToStaticMarkup(
    createElement(PrimerKeyStats, { quote, loading }),
  );
}

function withQuote(patch: Partial<QuoteSummaryLive>): string {
  return markup({ ...AAPL, ...patch });
}

// ---------------------------------------------------------------------------
// The next-earnings cell.
// ---------------------------------------------------------------------------

test("the next earnings cell reaches the grid with its estimated day", () => {
  const html = markup(AAPL);
  assert.match(html, /Next earnings \(est\.\)/);
  assert.match(html, /Oct 29, 2026/);
});

test("the next earnings day is pinned to UTC, not the reader's zone", () => {
  // 1793304000 is 2026-10-29T12:00:00Z. Read in UTC it is the 29th. This is the
  // value Yahoo itself formats as "2026-10-29".
  const html = markup(AAPL);
  assert.match(html, /Oct 29, 2026/);
  assert.doesNotMatch(html, /Oct 28, 2026/);
  assert.doesNotMatch(html, /Oct 30, 2026/);
});

test("a two-element earnings window draws its FIRST day, per quoteSummary.ts:116", () => {
  // What mapResult hands over for `earningsDate: [1793304000, 1793563200]`, a
  // company Yahoo has not got a confirmed date for. Element [0] is taken
  // unconditionally there, so the grid can only ever see the window's start.
  const html = withQuote({ nextEarningsDate: 1793304000 });
  assert.match(html, /Oct 29, 2026/);
  assert.doesNotMatch(html, /Nov 1, 2026/);
});

test("the next earnings cell never states a confirmed date", () => {
  const html = markup(AAPL);
  assert.match(html, /Next earnings \(est\.\)/);
  assert.match(html, /Estimated date \(Yahoo Finance\)/);
  assert.doesNotMatch(html, /confirmed/i);
  assert.doesNotMatch(html, /Next earnings</);
});

// ---------------------------------------------------------------------------
// The EPS-vs-consensus cell.
// ---------------------------------------------------------------------------

test("the EPS vs consensus cell reads surprisePct as a fraction, not whole percent", () => {
  const html = markup(AAPL);
  assert.match(html, /Last EPS vs consensus/);
  assert.match(html, /\+6\.74%/);
  // The bug this pins: forgetting the x100 draws "+0.07%" for a 6.74% beat.
  assert.doesNotMatch(html, /\+0\.07%/);
});

test("a miss keeps its minus and a beat keeps its plus", () => {
  assert.match(
    withQuote({ lastEarnings: { actualEPS: 1.1, estimateEPS: 1.4, surprisePct: -0.2143 } }),
    /-21\.43%/,
  );
  assert.match(
    withQuote({ lastEarnings: { actualEPS: 1.4, estimateEPS: 1.1, surprisePct: 0.2727 } }),
    /\+27\.27%/,
  );
});

test("a surprise that rounds to zero does not draw a plus sign", () => {
  const html = withQuote({
    lastEarnings: { actualEPS: 1.0, estimateEPS: 1.0, surprisePct: 0.000004 },
  });
  assert.match(html, /0\.00%/);
  assert.doesNotMatch(html, /\+0\.00%/);
});

test("the EPS vs consensus cell names what it compares", () => {
  assert.match(markup(AAPL), /Reported vs consensus \(Yahoo Finance\)/);
});

// ---------------------------------------------------------------------------
// Absence. The push at :60-62 skips nulls, so an absent field draws no cell
// rather than a blank one.
// ---------------------------------------------------------------------------

test("both earnings cells are absent, not blank, when the fields are null", () => {
  const html = withQuote({ nextEarningsDate: null, lastEarnings: null });
  assert.doesNotMatch(html, /Next earnings/);
  assert.doesNotMatch(html, /Last EPS vs consensus/);
  // The rest of the grid is untouched by their absence.
  assert.match(html, /Market cap/);
  assert.match(html, /52-week range/);
});

test("a lastEarnings object with a null surprisePct draws no cell", () => {
  const html = withQuote({
    lastEarnings: { actualEPS: 2.02, estimateEPS: null, surprisePct: null },
  });
  assert.doesNotMatch(html, /Last EPS vs consensus/);
});

test("a zero or negative earnings timestamp draws no cell", () => {
  assert.doesNotMatch(withQuote({ nextEarningsDate: 0 }), /Next earnings/);
  assert.doesNotMatch(withQuote({ nextEarningsDate: -1 }), /Next earnings/);
});

test("no quote at all still draws the sourced empty sentence, with no earnings cells", () => {
  const html = markup(null);
  assert.match(html, /primer-key-stats-empty/);
  assert.doesNotMatch(html, /Next earnings/);
  assert.doesNotMatch(html, /Last EPS vs consensus/);
});

// ---------------------------------------------------------------------------
// Copy guard.
//
// AN EXACT SET, NOT A BLOCKLIST, and the difference is the point. A blocklist
// only catches the words somebody thought of, and writing one here would also
// mean writing every banned word into the repo, which design-lint reads as an
// occurrence rather than as an assertion of absence. Pinning the full label and
// note set instead goes red on ANY new word reaching the grid, including one
// nobody listed. It is the seam: these strings are the entire reader-facing
// vocabulary of this component.
// ---------------------------------------------------------------------------

/** Every `<dt>` label the grid drew, in draw order. */
function labels(html: string): string[] {
  return [...html.matchAll(/<dt[^>]*>([^<]*)<\/dt>/g)].map((m) => m[1]);
}

/** Every attribution note the grid drew, in draw order. */
function notes(html: string): string[] {
  return [...html.matchAll(/<span[^>]*italic[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);
}

test("the grid's reader-facing vocabulary is exactly this set and nothing else", () => {
  const html = markup(AAPL);
  assert.deepEqual(labels(html), [
    "Market cap",
    "P/E (trailing)",
    "P/E (forward)",
    "EPS (TTM)",
    "52-week range",
    "Dividend yield",
    "Beta",
    "1y target",
    "Next earnings (est.)",
    "Last EPS vs consensus",
  ]);
  assert.deepEqual(notes(html), [
    "Analyst consensus (Yahoo Finance)",
    "Analyst consensus (Yahoo Finance)",
    "Estimated date (Yahoo Finance)",
    "Reported vs consensus (Yahoo Finance)",
  ]);
});

test("no em-dash reaches the grid", () => {
  // Written as an escape on purpose: the character itself is banned repo-wide,
  // including inside an assertion that it is absent.
  assert.doesNotMatch(markup(AAPL), /\u2014/);
});

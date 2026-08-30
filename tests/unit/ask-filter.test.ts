// Unit tests for Ask's field (src/lib/ask-filter.ts).
//
// WHY THESE AND NOT AN E2E SPEC. The filter is a pure function over rows the
// server already read, so every case it has is reachable without a browser, a
// database or a render. The browser half that is NOT reachable here, that
// typing narrows the list and that the URL never changes while you type, is
// measured on a production build and reported in the PR body.
//
// THE CONTRACT LOCKED HERE:
//
//   an empty query        -> every row, unchanged. The screen decides how many
//                            of them to draw.
//   a name, a ticker,     -> matched case-insensitively, on name OR ticker, in
//   a partial                the order the read returned them.
//   a row with no ticker  -> still matchable by name, never dropped for having
//                            a null in the other field.
//   a string matching     -> an empty list AND a sentence that says so, never
//   nothing                  an empty list on its own.
//   a whole question      -> the same substring match as anything else. This is
//                            the owner's named watch item: the field filters,
//                            it does not answer, and this test records that the
//                            behaviour is deliberate rather than a defect.
//
// Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { ASK_SHOWN, filterAskCompanies, filterBlurb } from "../../src/lib/ask-filter.ts";
import type { AskCompanyRow } from "../../src/lib/ask-companies-data.ts";

const row = (name: string, ticker: string | null, detail: string | null): AskCompanyRow => ({
  id: name.toLowerCase(),
  ticker,
  name,
  detail,
  href: `/company/${(ticker ?? name).toLowerCase()}`,
});

/* The head of the live read, near enough: five Technology rows, one that is
   not, and one real company with no ticker. */
const ROWS: AskCompanyRow[] = [
  row("SpaceX", "SPCX", "Aerospace & Defense"),
  row("Nvidia", "NVDA", "Technology"),
  row("Apple", "AAPL", "Technology"),
  row("Tesla", "TSLA", "Technology"),
  row("Microsoft", "MSFT", "Technology"),
  row("Meta", "META", "Technology"),
  row("Anthropic", null, "Technology"),
];

/* ── the empty query ─────────────────────────────────────────────────── */

test("an empty query gives every row back, in read order", () => {
  assert.deepEqual(filterAskCompanies(ROWS, ""), ROWS);
});

test("a query of only whitespace is an empty query, not a match on a space", () => {
  assert.deepEqual(filterAskCompanies(ROWS, "   "), ROWS);
});

/* ── the four shapes a reader types ──────────────────────────────────── */

test("a company name matches, whatever case it is typed in", () => {
  const hits = filterAskCompanies(ROWS, "nvidia");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].name, "Nvidia");
  assert.deepEqual(filterAskCompanies(ROWS, "NVIDIA"), hits);
});

test("a ticker matches, whatever case it is typed in", () => {
  const hits = filterAskCompanies(ROWS, "msft");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].name, "Microsoft");
  assert.deepEqual(filterAskCompanies(ROWS, "MSFT"), hits);
});

test("a partial matches every row that contains it, in read order", () => {
  // "ic" is inside Microsoft and inside Anthropic, and Microsoft is read first.
  assert.deepEqual(
    filterAskCompanies(ROWS, "ic").map((r) => r.name),
    ["Microsoft", "Anthropic"],
  );
});

test("a string nothing carries gives an empty list", () => {
  assert.deepEqual(filterAskCompanies(ROWS, "zzzzz"), []);
});

/* ── the two fields it matches on, and the one it does not ───────────── */

test("a tickerless row is matchable by name and is never dropped", () => {
  const hits = filterAskCompanies(ROWS, "anthropic");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].ticker, null);
});

test("the sector is NOT matched, so a tail cannot pull in five silent rows", () => {
  /* Sector is drawn as the quietest thing on the row. Matching it would make
     "tech" return five companies with no visible reason why. */
  assert.deepEqual(filterAskCompanies(ROWS, "technology"), []);
  assert.deepEqual(filterAskCompanies(ROWS, "aerospace"), []);
});

/* ── the owner's watch item ──────────────────────────────────────────── */

test("a whole question is filtered, not answered, and usually matches nothing", () => {
  /* Recorded deliberately. The field is labelled "Filter companies" and this is
     what it does with a question. It is a known watch item for testing, not an
     oversight, and nothing here pre-solves it. */
  assert.deepEqual(filterAskCompanies(ROWS, "What are the strongest theses this week?"), []);
  assert.equal(
    filterBlurb(0),
    "No company in this directory carries that name. Nothing beyond this list was searched.",
  );
});

test("a question that happens to name a company still only filters", () => {
  const hits = filterAskCompanies(ROWS, "apple");
  assert.equal(hits.length, 1);
  // The same needle inside a sentence matches nothing, because it is a
  // substring match over names and the sentence is not one.
  assert.deepEqual(filterAskCompanies(ROWS, "how is apple doing"), []);
});

/* ── what the screen says about a result ─────────────────────────────── */

test("the blurb counts the result and always keeps the sentence that scopes it", () => {
  const tail = "Nothing beyond this list was searched.";
  assert.ok(filterBlurb(0).endsWith(tail));
  assert.ok(filterBlurb(1).endsWith(tail));
  assert.ok(filterBlurb(9).endsWith(tail));
  assert.ok(filterBlurb(1).startsWith("One company"));
  assert.ok(filterBlurb(9).startsWith("9 companies"));
});

test("the standing row count is six", () => {
  assert.equal(ASK_SHOWN, 6);
});

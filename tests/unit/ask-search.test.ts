// Unit tests for Ask's field (src/lib/ask-search.ts).
//
// WHAT IS LOCKED HERE, and every one of these was a live defect or a live risk
// on the branch this replaced:
//
//   the field reaches the CORPUS       -> the request carries `q` and an
//                                         explicit small `limit`, never the
//                                         500-row default that measured 1.6 to
//                                         1.9 seconds.
//   under two characters               -> no request at all. The route ignores
//                                         `q` below two and would answer with
//                                         that default.
//   a failed read                      -> never renders as an empty result.
//                                         `payloadFaulted` reads the route's
//                                         200-with-an-error-field shape.
//   NO TYPO TOLERANCE IS PROMISED      -> measured, `?q=nvidai` returns zero
//                                         rows, and no copy on this screen may
//                                         suggest otherwise.
//   an unproved row                    -> travels as `href: null` and is drawn
//                                         unlinked. It is never dropped from a
//                                         search result and never given a href
//                                         nothing proved.
//
// Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ASK_SEARCH_LIMIT,
  askSearchUrl,
  belowMinimumLine,
  corpusFigure,
  directoryLine,
  parseAliasOf,
  parseAskSearchRows,
  payloadFaulted,
  pendingLine,
  reachesCorpus,
  searchBlurb,
  type AskSearchRow,
} from "../../src/lib/ask-search.ts";

const CORPUS = 5599;

function row(over: Partial<AskSearchRow> = {}): AskSearchRow {
  return { id: "c1", ticker: "SBUX", name: "Starbucks", detail: "Consumer", href: "/company/sbux", ...over };
}

/* ── the request, which is the whole of the fix ──────────────────────── */

test("the request always carries q and an explicit limit", () => {
  const url = askSearchUrl("starbucks");
  assert.match(url, /^\/api\/companies\?q=starbucks&limit=\d+$/);
  assert.equal(url.includes(`limit=${ASK_SEARCH_LIMIT}`), true);
});

test("the request never issues the unbounded default", () => {
  /* The 500-row default is the slow path and nothing on this screen needs it.
     A url with no `q` is the shape that reaches it. */
  assert.equal(askSearchUrl("st").includes("q="), true);
  assert.equal(askSearchUrl("st").includes("limit="), true);
});

test("a query is encoded, so a space or an ampersand cannot break the url", () => {
  assert.equal(askSearchUrl("nvidia corp"), `/api/companies?q=nvidia%20corp&limit=${ASK_SEARCH_LIMIT}`);
  assert.equal(askSearchUrl("a&b").includes("%26"), true);
});

test("nothing under two characters reaches the corpus", () => {
  assert.equal(reachesCorpus(""), false);
  assert.equal(reachesCorpus("s"), false);
  assert.equal(reachesCorpus("  s  "), false);
  assert.equal(reachesCorpus("st"), true);
});

/* ── the boundary between the wire and the screen ────────────────────── */

test("rows are narrowed at the boundary, not cast across it", () => {
  const rows = parseAskSearchRows({
    companies: [
      { id: "a", name: " Starbucks ", ticker: " sbux ", sector: " Consumer ", href: "/company/sbux" },
      { id: "", name: "No id" },
      { id: "b", name: "" },
      { id: "c", name: "Hostelworld Group", ticker: null, sector: null, href: null },
    ],
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    id: "a",
    ticker: "SBUX",
    name: "Starbucks",
    detail: "Consumer",
    href: "/company/sbux",
  });
  assert.deepEqual(rows[1], {
    id: "c",
    ticker: null,
    name: "Hostelworld Group",
    detail: null,
    href: null,
  });
});

test("a href that is not a string becomes null, never a link", () => {
  const [only] = parseAskSearchRows({ companies: [{ id: "a", name: "X Corp", href: 42 }] });
  assert.equal(only.href, null);
});

test("a payload with no companies array is an empty list, not a throw", () => {
  assert.deepEqual(parseAskSearchRows(null), []);
  assert.deepEqual(parseAskSearchRows({}), []);
  assert.deepEqual(parseAskSearchRows({ companies: "nope" }), []);
});

test("a failed read is detectable even though the route answers 200", () => {
  assert.equal(payloadFaulted({ companies: [], total: 0, error: "57014 statement timeout" }), true);
  /* An empty result is NOT a fault, and the two draw different sentences. */
  assert.equal(payloadFaulted({ companies: [], total: 0 }), false);
  assert.equal(payloadFaulted({ companies: [], total: 0, error: "" }), false);
});

test("the alias branch is reported as an alias, and only when the route says so", () => {
  assert.equal(
    parseAliasOf({ companies: [], alias_resolved: true, query_typed: "nvidia corp", canonical_name: "Nvidia" }),
    "nvidia corp",
  );
  assert.equal(parseAliasOf({ companies: [] }), null);
  assert.equal(parseAliasOf({ companies: [], alias_resolved: false, query_typed: "x" }), null);
});

/* ── the copy, which is the other half of the fix ────────────────────── */

/**
 * Everything a misspelling-forgiving search would say, and none of it may
 * appear on this screen. Measured: `?q=nvidai` returns zero rows, and there is
 * no trigram, no Levenshtein and no fuzzy match anywhere on the path.
 */
const FORGIVENESS = [
  "did you mean",
  "similar",
  "close match",
  "closest",
  "approximate",
  "fuzzy",
  "corrected",
  "try again",
];

function promisesForgiveness(line: string): boolean {
  const lower = line.toLowerCase();
  return FORGIVENESS.some((phrase) => lower.includes(phrase));
}

test("the zero-result sentence names the match rule and forgives nothing", () => {
  const line = searchBlurb({ query: "nvidai", rows: [], aliasOf: null }, CORPUS);
  assert.equal(promisesForgiveness(line), false);
  assert.equal(line.includes("nvidai"), true);
  /* It has to say WHY, or a reader concludes the corpus has no NVIDIA in it. */
  assert.equal(line.includes("substring"), true);
  /* The denial has to be explicit. A sentence that merely omits the promise
     leaves a reader to assume the search was cleverer than it is. */
  assert.equal(line.includes("a misspelling finds nothing"), true);
  assert.equal(line.includes("5,599"), true);
});

test("no sentence this module produces promises a misspelling is forgiven", () => {
  const lines = [
    searchBlurb({ query: "x", rows: [], aliasOf: null }, CORPUS),
    searchBlurb({ query: "x", rows: [row()], aliasOf: null }, CORPUS),
    searchBlurb({ query: "x", rows: [row(), row({ id: "c2" })], aliasOf: null }, CORPUS),
    searchBlurb({ query: "nvidia corp", rows: [row({ name: "Nvidia" })], aliasOf: "nvidia corp" }, CORPUS),
    pendingLine("x", CORPUS),
    belowMinimumLine(CORPUS),
    directoryLine(CORPUS),
  ];
  for (const line of lines) {
    assert.equal(promisesForgiveness(line), false, `forgiveness promised: ${line}`);
  }
});

test("the count in the sentence is read from the result, never typed", () => {
  const one = searchBlurb({ query: "starbucks", rows: [row()], aliasOf: null }, CORPUS);
  assert.equal(one.startsWith("One company"), true);
  const three = searchBlurb(
    { query: "star", rows: [row(), row({ id: "c2" }), row({ id: "c3" })], aliasOf: null },
    CORPUS,
  );
  assert.equal(three.startsWith("3 companies"), true);
});

test("a full page of matches says there may be more rather than implying there are not", () => {
  const rows = Array.from({ length: ASK_SEARCH_LIMIT }, (_, i) => row({ id: `c${i}` }));
  const line = searchBlurb({ query: "a", rows, aliasOf: null }, CORPUS);
  assert.equal(line.includes("There may be more"), true);
});

test("an unlinked match is counted out loud rather than left as a missing chevron", () => {
  const line = searchBlurb(
    { query: "hostelworld", rows: [row({ href: null, name: "Hostelworld Group" })], aliasOf: null },
    CORPUS,
  );
  assert.equal(line.includes("no company page yet"), true);

  const mixed = searchBlurb(
    { query: "a", rows: [row(), row({ id: "c2", href: null }), row({ id: "c3", href: null })], aliasOf: null },
    CORPUS,
  );
  assert.equal(mixed.includes("2 of them have no company page yet"), true);

  const allLinked = searchBlurb({ query: "a", rows: [row()], aliasOf: null }, CORPUS);
  assert.equal(allLinked.includes("company page"), false);
});

test("the alias sentence calls it an alias and not a correction", () => {
  const line = searchBlurb(
    { query: "nvidia corp", rows: [row({ name: "Nvidia" })], aliasOf: "nvidia corp" },
    CORPUS,
  );
  assert.equal(line.includes("alias"), true);
  assert.equal(promisesForgiveness(line), false);
});

/* ── the corpus figure, which survives the corpus growing ────────────── */

test("the corpus figure is grouped in en-US, fixed, so the server and the browser agree", () => {
  assert.equal(corpusFigure(5599), "5,599");
});

test("a faulted count drops the figure and keeps the claim", () => {
  assert.equal(corpusFigure(null), null);
  /* Never a zero. A zero would say the corpus is empty. */
  assert.equal(corpusFigure(0), null);

  const line = directoryLine(null);
  assert.equal(line.includes("null"), false);
  assert.equal(line.includes("0"), false);
  /* The reach claim survives without the number. */
  assert.equal(line.includes("reaches all of them"), true);

  const below = belowMinimumLine(null);
  assert.equal(below.includes("every company"), true);
});

test("the standing line carries the corpus size and the reach, not just the ordering", () => {
  const line = directoryLine(CORPUS);
  assert.equal(line.includes("5,599"), true);
  assert.equal(line.includes("reaches all of them"), true);
  /* It must not be the OLD number. 5,064 is the link ceiling, a bug figure
     rather than a coverage one, and it has no business in coverage copy. */
  assert.equal(line.includes("5,064"), false);
});

test("below two characters the screen says what one more character reaches", () => {
  const line = belowMinimumLine(CORPUS);
  assert.equal(line.includes("5,599"), true);
  assert.equal(line.toLowerCase().includes("one more character"), true);
});

/**
 * Unit tests for empty-state-copy.ts. Pure, deterministic, no network, no JSX.
 * Run: npx tsx --test src/components/company/tabs/empty-state-copy.test.ts
 *
 * These assertions pin the exact strings a user reads in an empty tab, which is
 * the whole point of the module existing separately from the .tsx.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INSIDER_COVERAGE_NOTE,
  filingsEmptyCopy,
  financialsEmptyCopy,
  insiderEmptyCopy,
  financialsUnreadableCopy,
  primerKeyFiguresEmptyCopy,
} from "./empty-state-copy";

test("filings copy differs by CIK and only the no-CIK branch says private", () => {
  assert.equal(filingsEmptyCopy(true), "No recent 8-K, periodic, or insider filings.");
  assert.match(filingsEmptyCopy(false), /private/);
  assert.doesNotMatch(filingsEmptyCopy(true), /private/);
});

test("financials copy is neutral in both branches", () => {
  for (const hasCik of [true, false]) {
    assert.doesNotMatch(financialsEmptyCopy(hasCik), /private|pre-IPO/i);
  }
});

test("insider no-CIK branch states the missing identity, claims nothing else", () => {
  const copy = insiderEmptyCopy(false);
  assert.equal(
    copy.headline,
    "No SEC identity is on file for this company, so Form 4 insider transactions are not tracked.",
  );
  // No coverage caveat: there is no SEC identity to caveat.
  assert.equal(copy.note, null);
  // Must NOT assert the company is private or a non-filer. cik === null also
  // covers an on-demand minted public ticker whose CIK is unresolved.
  assert.doesNotMatch(copy.headline, /private|pre-IPO|does not file/i);
});

test("insider has-CIK branch reports zero qualifying rows and keeps the P/S caveat", () => {
  const copy = insiderEmptyCopy(true);
  assert.equal(
    copy.headline,
    "No qualifying insider transactions are on file for this company.",
  );
  assert.equal(copy.note, INSIDER_COVERAGE_NOTE);
  assert.match(copy.note ?? "", /codes P and S/);
  assert.match(copy.note ?? "", /\$1,000,000/);
});

test("no branch claims a fix is pending or coming soon", () => {
  const all = [
    filingsEmptyCopy(true),
    filingsEmptyCopy(false),
    financialsEmptyCopy(true),
    financialsEmptyCopy(false),
    insiderEmptyCopy(true).headline,
    insiderEmptyCopy(true).note ?? "",
    insiderEmptyCopy(false).headline,
  ];
  for (const s of all) {
    assert.doesNotMatch(s, /pending|coming soon|ingest fix|not yet wired/i);
  }
});

test("copy carries no em-dashes", () => {
  const all = [
    INSIDER_COVERAGE_NOTE,
    insiderEmptyCopy(true).headline,
    insiderEmptyCopy(false).headline,
    filingsEmptyCopy(true),
    filingsEmptyCopy(false),
    financialsEmptyCopy(true),
    financialsEmptyCopy(false),
  ];
  for (const s of all) assert.equal(s.includes("—"), false);
});

/* ── the mobile primer's third state ─────────────────────────────────── */

test("primer key figures: a filed period gets its OWN sentence, not the two-state one", () => {
  /* GRAB. It has a CIK, it has a filed FY2022 period, and its only validated
     fact is `cost_of_revenue`, which is not one of the four the primer names.
     The two-state copy drew "Financials appear after the first periodic report"
     over a screen whose Financials section draws that filer's FY2022 cost of
     revenue one tab away. */
  const copy = primerKeyFiguresEmptyCopy(true, true);
  assert.notEqual(copy, financialsEmptyCopy(true));
  assert.doesNotMatch(copy, /appear after the first periodic report/);
  assert.match(copy, /Financials/);
});

test("primer key figures falls back to the shared copy when no period is filed", () => {
  assert.equal(primerKeyFiguresEmptyCopy(true, false), financialsEmptyCopy(true));
  assert.equal(primerKeyFiguresEmptyCopy(false, false), financialsEmptyCopy(false));
});

test("primer key figures: three distinct sentences, never two", () => {
  const seen = new Set([
    primerKeyFiguresEmptyCopy(false, false),
    primerKeyFiguresEmptyCopy(true, false),
    primerKeyFiguresEmptyCopy(true, true),
  ]);
  assert.equal(seen.size, 3);
});

test("primer key figures copy asserts nothing about a listing, and no em-dash", () => {
  for (const [cik, filed] of [[true, true], [true, false], [false, false]] as const) {
    const copy = primerKeyFiguresEmptyCopy(cik, filed);
    assert.doesNotMatch(copy, /private|pre-IPO|quoted|listed/i);
    assert.equal(copy.includes("\u2014"), false);
  }
});

/* ── a failed read says so, and asserts nothing about the company ────── */

test("the unreadable sentence is distinct from every emptiness sentence", () => {
  const copy = financialsUnreadableCopy();
  assert.notEqual(copy, financialsEmptyCopy(true));
  assert.notEqual(copy, financialsEmptyCopy(false));
  assert.notEqual(copy, primerKeyFiguresEmptyCopy(true, true));
});

test("the unreadable sentence claims nothing about the issuer", () => {
  const copy = financialsUnreadableCopy();
  /* The sentence it replaces, "Financials appear after the first periodic
     report", is a claim about the company's filing history, and it printed over
     Salesforce, which has five years of validated XBRL on file. */
  assert.doesNotMatch(copy, /periodic report|private|pre-IPO|quoted|no filings|not a filer/i);
  assert.match(copy, /could not be read/i);
  assert.equal(copy.includes("\u2014"), false);
});

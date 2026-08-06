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

// Unit tests for the Company Intel Filings / Financials empty-state copy
// (src/components/company/tabs/empty-state-copy.ts).
//
// Locks the public-with-CIK vs private classification. The tabs are .tsx and
// cannot load under node:test, so we test the pure copy decision the component
// renders verbatim -- the same "test the pure decision proves the gate" pattern
// as require-admin.test.ts. The contract:
//   filings:    hasCik true -> data-pending; false -> private / pre-IPO copy
//   financials: NEUTRAL in both branches, NEVER "private" / "pre-IPO" (a no-CIK
//               on-demand minted public ticker is not private)
// A freshly-IPO'd filer (ticker + sec_cik set, no 8-K/10-Q yet, e.g. SpaceX)
// resolves hasCik === true and must not read as private.
//
// Run: node --test tests/unit/company-tab-empty-state.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filingsEmptyCopy,
  financialsEmptyCopy,
} from "../../src/components/company/tabs/empty-state-copy.ts";
// edgarFilingsUrl is imported from the leaf module (sec-filings.ts re-exports it
// but pulls in a "@/" alias that node:test cannot resolve).
import { edgarFilingsUrl } from "../../src/lib/edgar-url.ts";

const PRIVATE = /private|pre-?IPO/i;

test("Filings: hasCik renders the new data-pending copy, never private/pre-IPO", () => {
  const copy = filingsEmptyCopy(true);
  assert.equal(copy, "No recent 8-K, periodic, or insider filings.");
  assert.doesNotMatch(copy, PRIVATE);
});

test("Filings: no CIK still renders the private/pre-IPO copy", () => {
  const copy = filingsEmptyCopy(false);
  assert.match(copy, PRIVATE);
  assert.match(copy, /private, pre-IPO/);
});

test("Financials: hasCik renders the pending-report copy, never private/pre-IPO", () => {
  const copy = financialsEmptyCopy(true);
  assert.equal(copy, "Financials appear after the first periodic report.");
  assert.doesNotMatch(copy, PRIVATE);
});

test("Financials: no CIK renders neutral copy, never private/pre-IPO", () => {
  const copy = financialsEmptyCopy(false);
  assert.equal(copy, "SEC fundamentals are not available for this company yet.");
  assert.doesNotMatch(copy, PRIVATE);
});

test("edgarFilingsUrl points at the SEC browse-edgar getcompany index", () => {
  const url = edgarFilingsUrl(1181412);
  const parsed = new URL(url);
  assert.equal(parsed.hostname, "www.sec.gov");
  assert.equal(parsed.pathname, "/cgi-bin/browse-edgar");
  assert.equal(parsed.searchParams.get("action"), "getcompany");
});

test("edgarFilingsUrl zero-pads the CIK to 10 digits", () => {
  const url = edgarFilingsUrl(1181412);
  // SpaceX CIK 1181412 -> 0001181412
  assert.match(url, /CIK=0001181412/);
  assert.equal(new URL(url).searchParams.get("CIK"), "0001181412");
});

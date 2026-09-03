/**
 * The public/private determination and the SEC read must not disagree.
 * Run: npx tsx --test src/lib/company-privacy-reconcile.test.ts
 *
 * TWO PATHS COMPUTED "IS THIS COMPANY PUBLIC" AND ONLY ONE WAS GUARDED.
 *   Path A, the header / ticker / PRIVATE badge:
 *     getCompanyDetail -> resolveAlias -> deriveTickerPrivacy(head.ticker),
 *     reading `companies.ticker` on the row anchored by a case-insensitive
 *     exact NAME match. It never touches the `aliases` table.
 *   Path B, the Filings / Insider / Financials tabs:
 *     resolveCompanyCik, reading `companies.sec_cik` on a row reached by id,
 *     then ticker, then name, then THROUGH `aliases`.
 * Neither is a superset of the other, so the page could reach a filer the
 * header called private (ExxonMobil) and could also deny an EDGAR identity the
 * header had already resolved (every /company/<TICKER> URL).
 *
 * The fixtures below are the real production shapes, reduced to the columns
 * that decide the outcome. `resolveCompanyCik` is CALLED, not restated: the
 * fake client answers the exact query shapes it issues, so an edit to its
 * resolution ORDER is visible here rather than mirrored.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveTickerPrivacy, reconcileTickerPrivacy } from "./company-privacy";
import { resolveCompanyCik } from "./sec-filings";

type Row = { id: string; name: string | null; ticker: string | null; sec_cik: number | null };
type AliasRow = { lookup_key: string; canonical_id: string };

/**
 * Production shapes, both directions of the defect.
 *
 * EXXONMOBIL: the brand-form row carries null in BOTH the ticker and sec_cik
 * columns; the filer row beside it carries XOM / 34088. The `aliases` table
 * links the surface form "ExxonMobil" to each of them, which is the bridge
 * only path B has. Path A anchors on the brand row by exact name, so the page
 * printed "Private" over the filer's financials.
 *
 * APPLE: one row, correct in every column. The defect there is the URL:
 * /company/AAPL reconstructs the slug to the bare string "AAPL", which is not
 * this row's NAME and is not an alias key, so path B resolved nothing while
 * path A's ticker branch resolved the row.
 */
const EXXON_BRAND: Row = { id: "exxon-brand", name: "ExxonMobil", ticker: null, sec_cik: null };
const EXXON_FILER: Row = { id: "exxon-filer", name: "Exxon", ticker: "XOM", sec_cik: 34088 };
const APPLE: Row = { id: "apple", name: "Apple", ticker: "AAPL", sec_cik: 320193 };
/** A genuinely private company: no ticker, no CIK, and no alias to a filer. */
const SPACEX: Row = { id: "spacex", name: "SpaceX", ticker: null, sec_cik: null };

const COMPANIES: Row[] = [EXXON_BRAND, EXXON_FILER, APPLE, SPACEX];
const ALIASES: AliasRow[] = [
  { lookup_key: "exxonmobil", canonical_id: EXXON_BRAND.id },
  { lookup_key: "exxonmobil", canonical_id: EXXON_FILER.id },
  { lookup_key: "exxon mobil", canonical_id: EXXON_FILER.id },
];

/**
 * Minimal PostgREST stand-in covering exactly the query shapes
 * resolveCompanyCik issues. `ilike` with no wildcards is a case-INSENSITIVE
 * exact match, which is what the real calls rely on and what the anchored-row
 * mismatch turns on, so it is modelled rather than lowered to `===`.
 */
function fakeSupabase(companies: Row[], aliases: AliasRow[]) {
  const ci = (a: string | null, b: string) => (a ?? "").toLowerCase() === b.toLowerCase();
  function builder(table: string) {
    let rows: unknown[] = table === "companies" ? [...companies] : [...aliases];
    const api = {
      select() { return api; },
      eq(col: string, val: unknown) {
        rows = (rows as Record<string, unknown>[]).filter((r) => r[col] === val);
        return api;
      },
      ilike(col: string, val: string) {
        rows = (rows as Record<string, unknown>[]).filter((r) => ci(r[col] as string | null, val));
        return api;
      },
      in(col: string, vals: unknown[]) {
        rows = (rows as Record<string, unknown>[]).filter((r) => vals.includes(r[col]));
        return api;
      },
      limit(n: number) { rows = rows.slice(0, n); return api; },
      then(resolve: (v: { data: unknown[]; error: null }) => unknown) {
        return Promise.resolve(resolve({ data: rows, error: null }));
      },
    };
    return api;
  }
  return { from: (table: string) => builder(table) } as never;
}

const db = fakeSupabase(COMPANIES, ALIASES);

// ---------------------------------------------------------------------------
// Path B: resolveCompanyCik must not answer with LESS than the name it was
// given, and must not answer with less than the header already knows.
// ---------------------------------------------------------------------------

test("a null-CIK id does not short-circuit past the alias bridge to the filer", async () => {
  // THE STEP-1 GUARD. The page now passes the anchored row's id, and that row
  // is the brand-form duplicate with no CIK. When step 1 returned on ANY row,
  // this came back null and the Financials tab went empty on a page that had
  // been rendering that filer's XBRL from the slug-derived name a moment ago.
  const res = await resolveCompanyCik(db, {
    id: EXXON_BRAND.id,
    name: EXXON_BRAND.name,
    ticker: EXXON_BRAND.ticker,
  });
  assert.equal(res.cik, 34088, "the alias bridge must still be reached when the id row has no CIK");
  assert.equal(res.ticker, "XOM");
});

test("an id whose row HAS a CIK still resolves on step 1 without consulting aliases", async () => {
  // The step-1 fast path is intact for the rows it was written for: a filer id
  // answers from its own row, so the change costs no extra query where the old
  // code was already right.
  const res = await resolveCompanyCik(db, { id: APPLE.id, name: APPLE.name, ticker: APPLE.ticker });
  assert.equal(res.cik, 320193);
  assert.equal(res.companyId, APPLE.id);
});

test("a company with no CIK anywhere still returns the id row's identity", async () => {
  // Step 5 must be unchanged for genuinely private companies: name and
  // companyId still come back so the tabs render an honest no-data state
  // rather than an empty resolution.
  const res = await resolveCompanyCik(db, { id: SPACEX.id, name: SPACEX.name, ticker: null });
  assert.equal(res.cik, null);
  assert.equal(res.companyId, SPACEX.id);
  assert.equal(res.name, "SpaceX");
});

test("the ticker on the ref rescues a /company/<TICKER> URL the name cannot", async () => {
  // /company/AAPL reconstructs to the bare string "AAPL", which matches no row
  // NAME and no alias key. Resolving on the name alone is the RELX/AAPL
  // direction of the defect; carrying the header's ticker is what closes it.
  const byBareSlug = await resolveCompanyCik(db, { name: "AAPL" });
  assert.equal(byBareSlug.cik, null, "the slug string alone cannot reach the filer, which is the bug");

  const withHeaderTicker = await resolveCompanyCik(db, {
    id: APPLE.id,
    name: APPLE.name,
    ticker: APPLE.ticker,
  });
  assert.equal(withHeaderTicker.cik, 320193, "the identity the header already resolved must be used");
});

// ---------------------------------------------------------------------------
// The reconciliation itself.
// ---------------------------------------------------------------------------

test("a company whose SEC identity resolved is not printed as private", () => {
  // The headline contradiction: path A says private, path B is rendering that
  // company's audited SEC financials on the same screen.
  const fromHeader = deriveTickerPrivacy(EXXON_BRAND.ticker);
  assert.deepEqual(fromHeader, { ticker: null, isPrivate: true }, "path A's answer, unchanged");

  const out = reconcileTickerPrivacy(fromHeader, { cik: 34088, ticker: "XOM" });
  assert.equal(out.isPrivate, false, "an EDGAR filer is not private");
  assert.equal(out.ticker, "XOM", "and the header names the ticker the tabs resolved");
});

test("both sides of the comparison are normalized by the same function", () => {
  // A comparison where one side is normalized and the other is not cannot
  // succeed, and that is the shape of this whole defect. `detail.ticker`
  // arrived through deriveTickerPrivacy; `filer.ticker` is raw companies.ticker
  // off a DIFFERENT row, so it must go through the same normalizer.
  const out = reconcileTickerPrivacy(deriveTickerPrivacy(null), { cik: 34088, ticker: "  xom  " });
  assert.equal(out.ticker, "XOM", "raw filer ticker must be trimmed and uppercased, not stored as read");
  assert.equal(out.ticker, deriveTickerPrivacy("  xom  ").ticker, "and by the same function, not a second copy");
});

test("a genuinely private company is left private", () => {
  // No ticker, no CIK: nothing contradicts path A, so nothing is asserted.
  const fromHeader = deriveTickerPrivacy(SPACEX.ticker);
  const out = reconcileTickerPrivacy(fromHeader, { cik: null, ticker: null });
  assert.equal(out.isPrivate, true);
  assert.equal(out.ticker, null);
});

test("a public company is returned untouched, by reference", () => {
  // THE ONE-DIRECTIONAL GUARD, asserted on the seam rather than on values.
  // The early return is the promise that this function can never re-decide a
  // company the ticker SOT already got right, so the object identity IS the
  // contract: a rebuilt object means the public branch was re-derived, whether
  // or not the values happened to land the same.
  const fromHeader = deriveTickerPrivacy(APPLE.ticker);
  const out = reconcileTickerPrivacy(fromHeader, { cik: 320193, ticker: "AAPL" });
  assert.equal(out, fromHeader, "a public company must short-circuit, not be rebuilt");
});

test("a filer with no ticker column is public without inventing a ticker", () => {
  // Defensive: prod carries no row with a CIK and a null ticker today, so this
  // pins the behaviour rather than describing a row. Not private (it files),
  // and no ticker is fabricated, so the KPI strip draws a neutral dash instead
  // of a PRIVATE badge or a wrong quote.
  const out = reconcileTickerPrivacy(deriveTickerPrivacy(null), { cik: 99, ticker: null });
  assert.equal(out.isPrivate, false);
  assert.equal(out.ticker, null);
});

// ---------------------------------------------------------------------------
// The two paths, end to end, on the shape that shipped.
// ---------------------------------------------------------------------------

test("header and tabs agree on ExxonMobil after resolving through the real resolver", async () => {
  // Both halves of the page, computed the way the page computes them, asserted
  // against each other rather than against a restatement of either.
  const header = deriveTickerPrivacy(EXXON_BRAND.ticker);
  const filer = await resolveCompanyCik(db, {
    id: EXXON_BRAND.id,
    name: EXXON_BRAND.name,
    ticker: EXXON_BRAND.ticker,
  });
  const shown = reconcileTickerPrivacy(header, { cik: filer.cik, ticker: filer.ticker });

  const tabsRenderSecData = filer.cik != null;
  assert.equal(tabsRenderSecData, true, "the tabs do render SEC data for this page");
  assert.equal(
    shown.isPrivate && tabsRenderSecData,
    false,
    "the page must never call a company private while rendering its SEC filings",
  );
});

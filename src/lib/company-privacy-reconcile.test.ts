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

/**
 * GENIUS GROUP: the third production shape, and the one that shows why the
 * URL's own string cannot be dropped as a match key.
 *
 * `resolveAlias` anchors on `canonicalize()`d input, and canonicalize collapses
 * "Genius Group" to "Genius", so `/company/genius-group` resolves a head on the
 * CIK-less row named "Genius". The row carrying that company's own ticker and
 * CIK is named "Genius Group", which is exactly what the URL reconstructs to
 * and is NOT what the head is called. No alias bridges the two.
 *
 * So the head's name is BETTER information about which company the page is on
 * and WORSE as a match key inside `companies`, and a resolver handed only the
 * head's name answers with less than the URL already knew.
 */
const GENIUS_HEAD: Row = { id: "genius-head", name: "Genius", ticker: null, sec_cik: null };
const GENIUS_FILER: Row = { id: "genius-filer", name: "Genius Group", ticker: "GNS", sec_cik: 1847806 };

const COMPANIES: Row[] = [EXXON_BRAND, EXXON_FILER, APPLE, SPACEX, GENIUS_HEAD, GENIUS_FILER];
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
 *
 * IT RECORDS EVERY READ. Some of the claims below are about WHICH STEP
 * answered, not about the value that came back, and a value assertion cannot
 * tell those apart: several steps resolve Apple to the same CIK, so a test that
 * only reads `res.cik` stays green when the step it names is deleted. The log
 * is the seam. See `queries()` and the step-1 test.
 */
function fakeSupabase(companies: Row[], aliases: AliasRow[]) {
  const log: string[] = [];
  const ci = (a: string | null, b: string) => (a ?? "").toLowerCase() === b.toLowerCase();
  function builder(table: string) {
    let rows: unknown[] = table === "companies" ? [...companies] : [...aliases];
    const trace: string[] = [];
    const api = {
      select() { return api; },
      eq(col: string, val: unknown) {
        trace.push(`eq(${col})`);
        rows = (rows as Record<string, unknown>[]).filter((r) => r[col] === val);
        return api;
      },
      ilike(col: string, val: string) {
        trace.push(`ilike(${col})`);
        rows = (rows as Record<string, unknown>[]).filter((r) => ci(r[col] as string | null, val));
        return api;
      },
      in(col: string, vals: unknown[]) {
        trace.push(`in(${col})`);
        rows = (rows as Record<string, unknown>[]).filter((r) => vals.includes(r[col]));
        return api;
      },
      limit(n: number) { rows = rows.slice(0, n); return api; },
      then(resolve: (v: { data: unknown[]; error: null }) => unknown) {
        log.push(`${table}.${trace.join(".")}`);
        return Promise.resolve(resolve({ data: rows, error: null }));
      },
    };
    return api;
  }
  return { client: { from: (table: string) => builder(table) } as never, log };
}

const fake = fakeSupabase(COMPANIES, ALIASES);
const db = fake.client;
/** Drain and return the reads issued since the last call. */
const queries = (): string[] => fake.log.splice(0, fake.log.length);

// ---------------------------------------------------------------------------
// Path B: resolveCompanyCik must not answer with LESS than the name it was
// given, and must not answer with less than the header already knows.
// ---------------------------------------------------------------------------

test("a null-CIK id does not short-circuit past the alias bridge to the filer", async () => {
  // THE STEP-1 CONDITION. The page now passes the anchored row's id, and that
  // row is the brand-form duplicate with no CIK. When step 1 returned on ANY
  // row, this came back null and the Financials tab went empty on a page that
  // had been rendering that filer's XBRL from the slug-derived name a moment
  // ago. Reverting the condition to `if (idRow)` reddens this.
  queries();
  const res = await resolveCompanyCik(db, {
    id: EXXON_BRAND.id,
    name: EXXON_BRAND.name,
    ticker: EXXON_BRAND.ticker,
  });
  assert.equal(res.cik, 34088, "the alias bridge must still be reached when the id row has no CIK");
  assert.equal(res.ticker, "XOM");
});

test("an id whose row HAS a CIK still resolves on step 1 without consulting aliases", async () => {
  /* THIS TEST NAMES A STEP, SO IT ASSERTS THE IO AND NOT THE VALUE, and the
     distinction is the whole reason the assertion looks like this.

     The value here is not discriminating: delete the step-1 early return
     outright and Apple still resolves to 320193 and to its own id, off the
     ticker match one step down. A `res.cik` assertion is green either way, so
     it proves the fixture and not the branch, which is the incidental
     fingerprint CLAUDE.md documents. What step 1 actually promises is that a
     CIK-bearing id is TERMINAL: one read, of `companies`, by id, and nothing
     after it. That is a claim about reads, so it is read off the reads.

     Deleting `if (idRow?.sec_cik != null) return toResolution(idRow);` reddens
     this, and so does reverting its condition. */
  queries();
  const res = await resolveCompanyCik(db, { id: APPLE.id, name: APPLE.name, ticker: APPLE.ticker });
  assert.deepEqual(
    queries(),
    ["companies.eq(id)"],
    "a CIK-bearing id must be terminal: one read, by id, and no ticker or alias lookup after it",
  );
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
// The URL's own string is a match key, and giving the ref a better `name` is
// not a reason to stop reading it.
// ---------------------------------------------------------------------------

test("the slug stays a match key once the page also sets a name", async () => {
  /* /company/genius-group. `resolveAlias` canonicalizes its input, which
     collapses "Genius Group" to the separate CIK-less row named "Genius", so
     the head this page gets is not the row carrying the company's own ticker
     and CIK. The URL reconstructs to the name that IS that row, and no alias
     bridges the two, so the slug is the only key that reaches the filer.

     `const raw = ref.name ?? ref.slug` made that key unreachable the moment a
     caller set a name, and this page now always sets one. Restoring `??` here
     reddens this test. */
  const res = await resolveCompanyCik(db, {
    id: GENIUS_HEAD.id,
    name: GENIUS_HEAD.name,
    ticker: null,
    slug: "Genius Group",
  });
  assert.equal(res.cik, 1847806, "the URL's own string must still reach the filer");
  assert.equal(res.ticker, "GNS");
  assert.equal(res.companyId, GENIUS_FILER.id);
});

test("the name leads, so a second surface form can add a filer but never swap one", async () => {
  /* THE NO-REDIRECT GUARANTEE, and the reason a second surface form is safe to
     add at all. `matchCompaniesByName` collects in the order it is given and
     `preferCik` takes the FIRST CIK-bearing candidate, so name-derived rows
     always win. A slug naming a DIFFERENT filer cannot move an answer the name
     already found; it can only answer where the name found nothing.

     Reversing the order of `surfaces` reddens this. */
  const res = await resolveCompanyCik(db, { name: APPLE.name, slug: "Exxon" });
  assert.equal(res.cik, 320193, "the name's filer must win over the slug's");
  assert.equal(res.companyId, APPLE.id);
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

// Fail-open contract tests for memo canonical identifier resolution.
//
// resolveMemoCompanyIdentifiers (src/lib/memo-company-canonical.ts) is the
// policy /api/memo applies before persisting a memo row. These tests pin the
// three invariants the route edit relies on, with stubbed lookups and zero
// network/DB:
//   1. a non-null company is NEVER rewritten (memo-cache matches
//      content->>'target_company' exactly; a rewrite breaks the cache)
//   2. lookup miss / ambiguity / thrown error degrades to exactly today's
//      behavior (company passes through, no ticker persisted)
//   3. ticker is only filled on an unambiguous companies-table match
//
// The DB leg (supabaseCompanyLookup against the live companies table) cannot
// be unit-tested offline; it is covered by the gated manual verification in
// the PR body.
//
// Run: node --test tests/unit/memo-company-canonical.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveMemoCompanyIdentifiers,
  type CompanyLookup,
  type CompanyRow,
} from "../../src/lib/memo-company-canonical.ts";

function lookup(byName: CompanyRow[] | Error, byTicker: CompanyRow[] | Error): CompanyLookup {
  return {
    async byName() {
      if (byName instanceof Error) throw byName;
      return byName;
    },
    async byTicker() {
      if (byTicker instanceof Error) throw byTicker;
      return byTicker;
    },
  };
}

const NONE: CompanyRow[] = [];

// --- Invariant 1: never rewrite a non-null company -------------------------

test("company name passes through unchanged even when the canonical row differs in casing", async () => {
  // BriefTab persisted "Bank Of America"; canonical row is "Bank of America".
  // Rewriting would break the exact-match memo cache, so the name must pass
  // through as sent and only the ticker may be enriched.
  const r = await resolveMemoCompanyIdentifiers(
    { company: "Bank Of America", ticker: null },
    lookup([{ name: "Bank of America", ticker: "BAC" }], NONE),
  );
  assert.equal(r.targetCompany, "Bank Of America");
  assert.equal(r.ticker, "BAC");
});

test("duplicate company rows sharing one ticker still enrich (NVIDIA dupe shape)", async () => {
  const r = await resolveMemoCompanyIdentifiers(
    { company: "NVIDIA", ticker: null },
    lookup(
      [
        { name: "NVIDIA", ticker: "NVDA" },
        { name: "Nvidia Corp", ticker: "NVDA" },
      ],
      NONE,
    ),
  );
  assert.equal(r.targetCompany, "NVIDIA");
  assert.equal(r.ticker, "NVDA");
});

test("conflicting tickers across duplicate rows persist no ticker", async () => {
  const r = await resolveMemoCompanyIdentifiers(
    { company: "Acme", ticker: null },
    lookup(
      [
        { name: "Acme", ticker: "ACME" },
        { name: "Acme Holdings", ticker: "ACMH" },
      ],
      NONE,
    ),
  );
  assert.equal(r.targetCompany, "Acme");
  assert.equal(r.ticker, null);
});

// --- Invariant 2: failure degrades to today's behavior ---------------------

test("name lookup miss passes the name through with no ticker", async () => {
  const r = await resolveMemoCompanyIdentifiers(
    { company: "Obscure Private Co", ticker: null },
    lookup(NONE, NONE),
  );
  assert.deepEqual(r, { targetCompany: "Obscure Private Co", ticker: null });
});

test("throwing lookup fails open to passthrough", async () => {
  const boom = new Error("companies table unavailable");
  const withCompany = await resolveMemoCompanyIdentifiers(
    { company: "Chevron", ticker: null },
    lookup(boom, boom),
  );
  assert.deepEqual(withCompany, { targetCompany: "Chevron", ticker: null });

  const tickerOnly = await resolveMemoCompanyIdentifiers(
    { company: null, ticker: "CVX" },
    lookup(boom, boom),
  );
  assert.deepEqual(tickerOnly, { targetCompany: null, ticker: null });
});

test("no identifiers at all resolves to nulls (today's null-company write)", async () => {
  const r = await resolveMemoCompanyIdentifiers(
    { company: null, ticker: null },
    lookup(NONE, NONE),
  );
  assert.deepEqual(r, { targetCompany: null, ticker: null });
});

// --- Invariant 3: ticker path fills target_company only on unambiguous hit --

test("ticker-only input resolves to canonical name plus uppercased ticker", async () => {
  const r = await resolveMemoCompanyIdentifiers(
    { company: null, ticker: "mrvl" },
    lookup(NONE, [{ name: "Marvell Technology", ticker: "MRVL" }]),
  );
  assert.deepEqual(r, { targetCompany: "Marvell Technology", ticker: "MRVL" });
});

test("ticker lookup miss persists nothing", async () => {
  const r = await resolveMemoCompanyIdentifiers(
    { company: null, ticker: "ZZZZ" },
    lookup(NONE, NONE),
  );
  assert.deepEqual(r, { targetCompany: null, ticker: null });
});

test("ticker resolving to multiple distinct names persists nothing", async () => {
  const r = await resolveMemoCompanyIdentifiers(
    { company: null, ticker: "DUPE" },
    lookup(NONE, [
      { name: "Dupe Industries", ticker: "DUPE" },
      { name: "Dupe Energy", ticker: "DUPE" },
    ]),
  );
  assert.deepEqual(r, { targetCompany: null, ticker: null });
});

test("implausible ticker shapes never reach the lookup", async () => {
  const neverCalled: CompanyLookup = {
    async byName() {
      throw new Error("byName should not be called");
    },
    async byTicker() {
      throw new Error("byTicker should not be called");
    },
  };
  for (const bad of ["not a ticker!!", "", "   ", "WAY-TOO-LONG-TICKER", "1ABC"]) {
    const r = await resolveMemoCompanyIdentifiers({ company: null, ticker: bad }, neverCalled);
    assert.deepEqual(r, { targetCompany: null, ticker: null });
  }
});

test("explicit company wins over a supplied ticker (no ticker-path override)", async () => {
  const r = await resolveMemoCompanyIdentifiers(
    { company: "Alphabet", ticker: "MSFT" },
    lookup([{ name: "Alphabet", ticker: "GOOGL" }], [{ name: "Microsoft", ticker: "MSFT" }]),
  );
  assert.equal(r.targetCompany, "Alphabet");
  assert.equal(r.ticker, "GOOGL");
});

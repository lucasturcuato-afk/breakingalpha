// Unit tests for the Ask company directory read (src/lib/ask-companies-data.ts).
//
// WHY THESE AND NOT AN E2E SPEC. `/ask` is a server component: the read goes
// from the Next server to Postgres and never through the browser, so
// `page.route()` cannot reach it and Playwright cannot force it to fault. This
// hands the loader a client that fails on command, and drives the pure mapper
// directly for everything that does not need one.
//
// THE CONTRACT LOCKED HERE:
//
//   a read that FAULTED        -> { data: null, stage: "error" }
//   a read that found NOTHING  -> { data: [], stage: "ready" }
//                                 The two are different values, because the
//                                 screen says different sentences about them.
//   a row whose slug PROVES    -> a row, linked at the slug that proved
//   a row whose slug does NOT  -> omitted. Never a row whose chevron lands on
//                                 the company empty state.
//   a row with NO ticker       -> kept when its name proves, ticker null. The
//                                 head of this read carries Anthropic and
//                                 OpenAI, so dropping tickerless rows would
//                                 silently misdescribe the ordering.
//
// The first one is the one the unit exists for. Collapsing a faulted read into
// an empty list would put "the read answered with no companies" on the screen
// over a query that never answered at all.
//
// Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildAskCompanies,
  loadAskCompanies,
  resolvesTo,
  type DirectoryReadRow,
} from "../../src/lib/ask-companies-data.ts";

/* ── a Supabase client that answers however it is told ───────────────── */

interface Result {
  data: unknown;
  error: { message: string } | null;
}

function clientFor(result: Result): SupabaseClient {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "not", "order", "limit"]) {
    chain[method] = () => chain;
  }
  // Thenable, so `await query` resolves exactly as PostgREST would.
  chain.then = (ok: (v: Result) => unknown, fail?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(ok, fail);
  return { from: () => chain } as unknown as SupabaseClient;
}

/**
 * A small corpus with one of every case in it.
 *
 * `Nvidia` resolves through the ticker branch. `Anthropic` has no ticker and
 * resolves through the name branch. `Alphabet` is here so `Google` has
 * something to canonicalize onto. `4` and `abc` are the two shapes the shared
 * noise filter drops. `Alpha-Beta Systems` proves neither way: the slug swaps
 * its hyphen for a space on the way back, so the reconstruction is a name no
 * row carries, and its ticker is outside the ticker branch's own shape.
 */
const ROWS: DirectoryReadRow[] = [
  { id: "c1", name: "Nvidia", ticker: "NVDA", sector: "Technology" },
  { id: "c2", name: "Anthropic", ticker: null, sector: "Technology" },
  { id: "c3", name: "Alphabet", ticker: "GOOGL", sector: "Technology" },
  { id: "c4", name: "Alpha-Beta Systems", ticker: "BRK.B", sector: "Industrials" },
  { id: "c5", name: "4", ticker: null, sector: null },
  { id: "c6", name: "abc", ticker: null, sector: null },
  { id: "c7", name: "  Micron  ", ticker: " mu ", sector: "  Technology  " },
];

/* ── the tri-state ───────────────────────────────────────────────────── */

test("a faulted read gives null data, never an empty list", async () => {
  const load = await loadAskCompanies(clientFor({ data: null, error: { message: "57014 statement timeout" } }));
  assert.equal(load.stage, "error");
  assert.equal(load.data, null);
});

test("a read that found nothing gives an empty list, never null", async () => {
  const load = await loadAskCompanies(clientFor({ data: [], error: null }));
  assert.equal(load.stage, "ready");
  assert.deepEqual(load.data, []);
});

test("a read that answered gives rows", async () => {
  const load = await loadAskCompanies(clientFor({ data: ROWS, error: null }));
  assert.equal(load.stage, "ready");
  assert.ok(load.data !== null);
  assert.ok(load.data.length > 0);
});

/* ── the mapping ─────────────────────────────────────────────────────── */

test("a ticker row links at its own ticker, uppercased in the chip", () => {
  const [row] = buildAskCompanies([ROWS[0]], 6);
  assert.equal(row.name, "Nvidia");
  assert.equal(row.ticker, "NVDA");
  assert.equal(row.detail, "Technology");
  assert.equal(row.href, "/company/nvda");
});

test("name, ticker and sector are trimmed, and the ticker chip is upper case", () => {
  const rows = buildAskCompanies(ROWS, 10);
  const micron = rows.find((r) => r.name === "Micron");
  assert.ok(micron, "Micron should survive the mapping");
  assert.equal(micron.ticker, "MU");
  assert.equal(micron.detail, "Technology");
  assert.equal(micron.href, "/company/mu");
});

test("a row with no ticker is kept when its name proves, with a null chip", () => {
  const rows = buildAskCompanies(ROWS, 10);
  const anthropic = rows.find((r) => r.name === "Anthropic");
  assert.ok(anthropic, "a tickerless company must not be dropped for having no ticker");
  assert.equal(anthropic.ticker, null);
  assert.equal(anthropic.href, "/company/anthropic");
});

test("a row that proves neither way is omitted, not linked", () => {
  const rows = buildAskCompanies(ROWS, 10);
  assert.equal(
    rows.find((r) => r.name === "Alpha-Beta Systems"),
    undefined,
  );
});

test("the shared noise filter drops what /api/companies drops", () => {
  const rows = buildAskCompanies(ROWS, 10);
  assert.equal(rows.find((r) => r.name === "4"), undefined);
  assert.equal(rows.find((r) => r.name === "abc"), undefined);
});

test("the cap counts rows kept, not rows read", () => {
  // ROWS carries three rows that never survive the mapping. A cap that counted
  // reads would give back fewer than it was asked for.
  const rows = buildAskCompanies(ROWS, 3);
  assert.equal(rows.length, 3);
});

test("a null sector leaves the detail line absent rather than substituted", () => {
  const [row] = buildAskCompanies([{ id: "x", name: "Nvidia", ticker: "NVDA", sector: null }], 6);
  assert.equal(row.detail, null);
});

/* ── the proof itself ────────────────────────────────────────────────── */

test("resolvesTo takes the ticker branch only for a ticker the read returned", () => {
  const tickers = new Set(["NVDA"]);
  const names = new Set(["nvidia"]);
  assert.equal(resolvesTo("nvda", tickers, names), true);
  // A ticker shape nothing in the read carries.
  assert.equal(resolvesTo("zzzz", tickers, new Set<string>()), false);
});

test("resolvesTo follows a canonical redirect onto the row it redirects to", () => {
  // "Google" canonicalizes to "Alphabet", which is a real destination. The
  // check has to accept it, or the directory would drop one of the most
  // mentioned names in the corpus for landing on its own canonical row.
  const tickers = new Set(["GOOGL"]);
  const names = new Set(["alphabet"]);
  assert.equal(resolvesTo("google", tickers, names), true);
});

test("resolvesTo refuses a slug whose reconstruction names no row that was read", () => {
  assert.equal(resolvesTo("alpha-beta-systems", new Set<string>(), new Set(["alpha-beta systems"])), false);
});

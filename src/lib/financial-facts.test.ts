/**
 * Call-level tests for the bounded financials read.
 * Run: npx tsx --test src/lib/financial-facts.test.ts
 *
 * `financial_facts_latest` is a DISTINCT ON view, and Postgres pushes a qual
 * into a DISTINCT ON subquery only when the qual's column is in the DISTINCT ON
 * key. `cik` and `period_end` are; `fiscal_period` is not, and LIMIT cannot
 * apply before the dedup. So without a `period_end` bound the read materialises
 * a company's ENTIRE filing history to draw thirteen columns, and the cost
 * scales with that company's row count until the largest filers reach the
 * statement timeout and come back as 57014.
 *
 * What a reviewer cannot see by loading Nvidia is what the module now DOES with
 * that bound: a company that fills its annual quota inside the window must
 * issue ONE bounded read and stop, and a company that cannot must widen to the
 * full history rather than quietly drawing a short table. These pin both, plus
 * the failure contract that the bound must not weaken.
 *
 * The fake client is a chainable thenable, the same shape
 * tests/unit/company-detail-article-window.test.ts uses: every PostgREST
 * builder method returns itself and records its arguments, and awaiting it
 * yields the canned row set queued for that table. That is enough to count
 * reads per table and to read back the `period_end` bound each read was built
 * with. Fixtures carry `accession_number: null` so no code path reaches the
 * network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchCompanyFinancials,
  factLookbackCutoff,
  ANNUAL_PERIODS,
  FACT_LOOKBACK_YEARS,
} from "./financial-facts";

type Canned = { data: unknown; error: unknown };
type Call = { table: string; index: number; method: string; args: unknown[] };

const CHAIN_METHODS = ["select", "eq", "ilike", "in", "gte", "lte", "order", "limit", "or"] as const;

function makeSupabase(plan: Record<string, Canned[]>) {
  const calls: Call[] = [];
  const counts: Record<string, number> = {};
  const from = (table: string) => {
    const index = counts[table] ?? 0;
    counts[table] = index + 1;
    const settle = () => {
      const queue = plan[table] ?? [];
      return queue[Math.min(index, queue.length - 1)] ?? { data: [], error: null };
    };
    const builder: Record<string, unknown> = {};
    for (const m of CHAIN_METHODS) {
      builder[m] = (...args: unknown[]) => {
        calls.push({ table, index, method: m, args });
        return builder;
      };
    }
    builder.maybeSingle = () => Promise.resolve(settle());
    builder.then = (ok: unknown, err: unknown) =>
      Promise.resolve(settle()).then(ok as never, err as never);
    return builder;
  };
  return {
    client: { from } as unknown as SupabaseClient,
    calls,
    factReadCount: () => counts.financial_facts_latest ?? 0,
    /** The `period_end` lower bound the nth facts read was built with, or null. */
    factCutoff: (n: number) => {
      const c = calls.find(
        (x) =>
          x.table === "financial_facts_latest" &&
          x.index === n &&
          x.method === "gte" &&
          x.args[0] === "period_end",
      );
      return c ? (c.args[1] as string) : null;
    },
  };
}

const COMPANY = [{ id: "c0000000-0000-0000-0000-000000000001", name: "Testco", ticker: "TST", sec_cik: 4242 }];

/** One validated annual row per fiscal year, newest first, USD. */
function annualRows(years: number[]) {
  return years.map((y) => ({
    metric_key: "revenue",
    period_type: "duration",
    fiscal_year: y,
    fiscal_period: "FY",
    period_end: `${y}-12-31`,
    unit: "USD",
    value: 1_000_000 * y,
    filing_url: null,
    accession_number: null,
  }));
}

const THIS_YEAR = new Date().getUTCFullYear();

// ---------------------------------------------------------------------------
// The guard. THIS is the test that must go red if the widening branch in
// fetchCompanyFinancials is deleted.
// ---------------------------------------------------------------------------
test("widens to the full history when the lookback window cannot fill the annual quota", async () => {
  // A dormant filer: every fiscal year it ever reported is older than the
  // window, so the bounded read comes back empty. The unbounded re-read is the
  // only thing that can draw its table.
  const dormant = [THIS_YEAR - 14, THIS_YEAR - 13, THIS_YEAR - 12, THIS_YEAR - 11, THIS_YEAR - 10];
  const s = makeSupabase({
    companies: [{ data: COMPANY, error: null }],
    financial_facts_latest: [
      { data: [], error: null }, // bounded: window is empty for this filer
      { data: annualRows(dormant), error: null }, // unbounded: the real history
    ],
    sec_filings: [{ data: [], error: null }],
  });

  const r = await fetchCompanyFinancials(s.client, { name: "Testco" });

  assert.equal(r.readFailed, false, "a successful widened read is not a failure");
  assert.equal(s.factReadCount(), 2, "must issue the bounded read AND the widening re-read");
  assert.equal(s.factCutoff(0), factLookbackCutoff(), "first read is bounded");
  assert.equal(s.factCutoff(1), null, "second read carries no period_end bound");
  assert.equal(
    r.annual.periods.length,
    ANNUAL_PERIODS,
    "the dormant filer's five annual columns must survive the lookback bound",
  );
  assert.deepEqual(
    r.annual.periods.map((p) => p.fiscalYear),
    [...dormant].sort((a, b) => b - a),
    "and they must be the years it actually filed",
  );
});

test("a filer that fills the annual quota inside the window issues exactly one read", async () => {
  const recent = [THIS_YEAR - 1, THIS_YEAR - 2, THIS_YEAR - 3, THIS_YEAR - 4, THIS_YEAR - 5];
  const s = makeSupabase({
    companies: [{ data: COMPANY, error: null }],
    financial_facts_latest: [{ data: annualRows(recent), error: null }],
    sec_filings: [{ data: [], error: null }],
  });

  const r = await fetchCompanyFinancials(s.client, { name: "Testco" });

  assert.equal(s.factReadCount(), 1, "no widening read for a company already at quota");
  assert.equal(r.annual.periods.length, ANNUAL_PERIODS);
  assert.equal(r.readFailed, false);
});

test("the first read is bounded on period_end by exactly FACT_LOOKBACK_YEARS", async () => {
  const s = makeSupabase({
    companies: [{ data: COMPANY, error: null }],
    financial_facts_latest: [{ data: annualRows([THIS_YEAR - 1, THIS_YEAR - 2, THIS_YEAR - 3, THIS_YEAR - 4, THIS_YEAR - 5]), error: null }],
    sec_filings: [{ data: [], error: null }],
  });
  await fetchCompanyFinancials(s.client, { name: "Testco" });

  const cutoff = s.factCutoff(0);
  assert.ok(cutoff, "the bounded read must carry a period_end floor");
  const years = (new Date().getTime() - new Date(cutoff).getTime()) / (365.25 * 864e5);
  assert.ok(
    Math.abs(years - FACT_LOOKBACK_YEARS) < 0.02,
    `period_end floor should be ~${FACT_LOOKBACK_YEARS}y back, got ${years.toFixed(2)}y`,
  );
});

test("a failed bounded read still reports readFailed, not an empty company", async () => {
  const s = makeSupabase({
    companies: [{ data: COMPANY, error: null }],
    financial_facts_latest: [{ data: null, error: { message: "canceling statement due to statement timeout" } }],
    sec_filings: [{ data: [], error: null }],
  });

  const r = await fetchCompanyFinancials(s.client, { name: "Testco" });

  assert.equal(r.readFailed, true, "57014 must never be collapsed into an empty view");
  assert.equal(r.cik, 4242, "the CIK is known even when the read failed");
  assert.equal(r.annual.periods.length, 0);
});

test("a failed WIDENING read reports readFailed rather than a possibly-truncated table", async () => {
  // The bounded read returned something, but not enough to trust. Drawing it
  // anyway would assert a short filing history the company may not have.
  const s = makeSupabase({
    companies: [{ data: COMPANY, error: null }],
    financial_facts_latest: [
      { data: annualRows([THIS_YEAR - 1, THIS_YEAR - 2]), error: null },
      { data: null, error: { message: "canceling statement due to statement timeout" } },
    ],
    sec_filings: [{ data: [], error: null }],
  });

  const r = await fetchCompanyFinancials(s.client, { name: "Testco" });

  assert.equal(s.factReadCount(), 2);
  assert.equal(r.readFailed, true);
  assert.equal(r.annual.periods.length, 0, "no partial table is drawn as though it were whole");
});

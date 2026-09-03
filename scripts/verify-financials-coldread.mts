/**
 * Verification harness for the financial_facts_latest cold-read timeout.
 * NOT shipped code; a reviewer-facing proof. READ-ONLY: it issues SELECTs and
 * nothing else. Run:
 *   npx tsx --env-file=.env.local scripts/verify-financials-coldread.mts
 *
 * It replays the REAL fetchCompanyFinancials against the REAL database for a
 * fixed 24-company page set, one company at a time at human pace (no
 * concurrency, no load generation), and prints whether each company's financial
 * read succeeded. `readFailed` is the headline: it is true only when the query
 * itself failed, which is the state that renders "Financial data could not be
 * read just now".
 *
 * The 24 are chosen to span fact-row volume, because volume -- not market cap --
 * is what the measurements identified as the driver. Stryker and Intrepid
 * Potash are in the set on purpose: both are non-mega-caps that were observed
 * returning Postgres 57014 on this query.
 *
 * CAVEAT, and it matters for reading the "before" number: Postgres buffer-cache
 * state is not controllable from here and was NOT manipulated. A company whose
 * pages are already resident reads quickly and passes regardless of the bug.
 * This harness therefore measures the WARM floor, and understates the cold
 * failure rate that the defect report describes. Compare the two runs to each
 * other, not against an absolute pass bar.
 */
import { createClient } from "@supabase/supabase-js";
import { fetchCompanyFinancials } from "../src/lib/financial-facts.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("NOT RUN: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is absent.");
  process.exit(1);
}
// Anon: the role a signed-out server render uses, and the tighter
// statement_timeout of the two roles that serve this page.
const supabase = createClient(url, key, { auth: { persistSession: false } });

/** The 24-page set, grouped by fact-row volume rather than by market cap. */
const PAGES: Array<{ name: string; band: string }> = [
  // The eight named mega-caps that resolve to a CIK.
  { name: "Nvidia", band: "mega" },
  { name: "Apple", band: "mega" },
  { name: "Microsoft", band: "mega" },
  { name: "Tesla", band: "mega" },
  { name: "Amazon", band: "mega" },
  { name: "Meta", band: "mega" },
  { name: "IBM", band: "mega" },
  { name: "Oracle", band: "mega" },
  // Named in the defect report but has no CIK at all; cannot reach the query.
  { name: "Facebook", band: "no-cik" },
  // Non-mega-caps with mega-cap-sized fact volume. Both observed at 57014.
  { name: "Stryker Corporation", band: "high" },
  { name: "Intrepid Potash", band: "high" },
  { name: "Consolidated Water", band: "high" },
  { name: "Altria Group, Inc.", band: "high" },
  { name: "Select Medical", band: "high" },
  { name: "iHeartMedia", band: "high" },
  // Mid volume.
  { name: "PTC", band: "mid" },
  { name: "TopBuild Corp.", band: "mid" },
  { name: "Astrana Health", band: "mid" },
  { name: "GoPro", band: "mid" },
  { name: "SM Energy", band: "mid" },
  // Low volume.
  { name: "Hydro One", band: "low" },
  { name: "BingEx Limited", band: "low" },
  { name: "VinFast", band: "low" },
  { name: "Brookfield", band: "low" },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const rows: Array<Record<string, unknown>> = [];
console.log("name\tband\tcik\treadFailed\tannualCols\tquarterCols\tcurrency\tms");
for (const p of PAGES) {
  const t0 = performance.now();
  const r = await fetchCompanyFinancials(supabase, { name: p.name });
  const ms = Math.round(performance.now() - t0);
  const row = {
    name: p.name,
    band: p.band,
    cik: r.cik ?? "null",
    readFailed: r.readFailed,
    annualCols: r.annual.periods.length,
    quarterCols: r.quarterly.periods.length,
    currency: r.reportingCurrency ?? "-",
    ms,
  };
  rows.push(row);
  console.log(Object.values(row).join("\t"));
  await sleep(600); // human pace, one page at a time
}

const failed = rows.filter((r) => r.readFailed === true);
const drew = rows.filter((r) => (r.annualCols as number) > 0);
console.log(`\nreadFailed: ${failed.length} / ${rows.length}` +
  (failed.length ? `  -> ${failed.map((r) => r.name).join(", ")}` : ""));
console.log(`drew an annual table: ${drew.length} / ${rows.length}`);

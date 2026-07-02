/**
 * Read-only sample-render harness for the thin-news fallback.
 *
 * Proves tier selection keys on REAL data presence: it queries the same tables
 * the product data-access reads (companies.sec_cik, financial_facts_latest,
 * sec_filings), then calls the REAL selectTier and the REAL formatValue to
 * produce the structured content the component renders. No writes.
 *
 * Queries mirror src/lib/sec-filings.ts (resolveCompanyCik), src/lib/
 * financial-facts.ts (fetchCompanyFinancials), and the sec_filings read.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

import { selectTier } from "../src/lib/thin-fallback-tier.ts";
import { formatValue } from "../src/components/company/tabs/financials-format.ts";

function env(k: string): string {
  for (const line of readFileSync("/Users/noahhanning/breakingalpha/.env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(new RegExp(`^${k}\\s*=\\s*(.+)$`));
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  throw new Error(`${k} missing`);
}

const sb = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

const UNIT_BY_METRIC: Record<string, string> = {
  revenue: "USD", gross_profit: "USD", operating_income: "USD", net_income: "USD",
  eps_diluted: "USD/shares",
};
const SNAP: { key: string; label: string; fmt: "usd" | "eps" }[] = [
  { key: "revenue", label: "Revenue", fmt: "usd" },
  { key: "gross_profit", label: "Gross profit", fmt: "usd" },
  { key: "operating_income", label: "Operating income", fmt: "usd" },
  { key: "net_income", label: "Net income", fmt: "usd" },
  { key: "eps_diluted", label: "EPS (diluted)", fmt: "eps" },
];

async function resolveCik(name: string) {
  // Mirrors resolveCompanyCik: ilike on companies.name, select sec_cik.
  const { data } = await sb.from("companies").select("id, name, ticker, sec_cik").ilike("name", name).limit(1);
  return data?.[0] ?? null;
}

async function run(label: string, name: string) {
  console.log(`\n${"=".repeat(64)}\n### ${label}: "${name}"\n${"=".repeat(64)}`);
  const company = await resolveCik(name);
  if (!company) { console.log(`  (no companies row) -> resolveCompanyCik cik=null`); }
  const cik: number | null = company?.sec_cik ?? null;
  console.log(`  companies.sec_cik = ${cik ?? "null"}   (id=${company?.id ?? "n/a"}, ticker=${company?.ticker ?? "n/a"})`);

  // financial_facts_latest presence (mirrors fetchCompanyFinancials query).
  let factRows: Array<Record<string, unknown>> = [];
  if (cik != null) {
    const { data } = await sb.from("financial_facts_latest")
      .select("metric_key, fiscal_period, fiscal_year, period_end, unit, value, filing_url, accession_number")
      .eq("cik", cik).in("fiscal_period", ["FY", "Q1", "Q2", "Q3", "Q4"])
      .order("period_end", { ascending: false }).limit(1000);
    factRows = (data ?? []).filter((r) => UNIT_BY_METRIC[r.metric_key as string] === (r.unit as string) || !(r.metric_key as string in UNIT_BY_METRIC));
  }
  const annualFY = factRows.filter((r) => r.fiscal_period === "FY");
  const xbrlPresent = annualFY.length > 0 || factRows.length > 0;

  // sec_filings presence (mirrors fetchCompanyFilings query).
  let filings: Array<Record<string, unknown>> = [];
  if (cik != null) {
    const { data } = await sb.from("sec_filings")
      .select("accession_number, form_type, filing_date, primary_doc_url")
      .eq("cik", cik).order("filing_date", { ascending: false }).limit(8);
    filings = data ?? [];
  }

  const tier = selectTier(xbrlPresent, filings.length, cik);
  console.log(`  DATA PRESENCE -> xbrlPresent=${xbrlPresent} (fact rows=${factRows.length}), filings=${filings.length}, cik=${cik != null}`);
  console.log(`  >>> TIER ${tier}\n`);

  if (tier === "A") {
    // Latest FY snapshot, built from structured facts only (no narration).
    const latestFY = annualFY.length ? Math.max(...annualFY.map((r) => Number(r.fiscal_year))) : null;
    const cell = (k: string) => {
      const r = annualFY.find((x) => x.metric_key === k && Number(x.fiscal_year) === latestFY && UNIT_BY_METRIC[k] === x.unit);
      return r ? Number(r.value) : null;
    };
    console.log(`  --- RENDERED: Financial snapshot (FY${latestFY}) ---`);
    for (const m of SNAP) {
      const v = cell(m.key);
      if (v != null && Number.isFinite(v)) console.log(`      ${m.label.padEnd(18)} ${formatValue(v, m.fmt)}`);
    }
    const rev = cell("revenue");
    if (rev) {
      for (const [lbl, k] of [["Gross margin", "gross_profit"], ["Operating margin", "operating_income"], ["Net margin", "net_income"]] as const) {
        const n = cell(k);
        if (n != null) console.log(`      ${lbl.padEnd(18)} ${formatValue(n / rev, "pct")}`);
      }
    }
    console.log(`  --- RENDERED: Recent SEC filings (date | form | doc), NO summaries ---`);
    for (const f of filings) console.log(`      ${String(f.filing_date).slice(0, 10)}  ${String(f.form_type ?? "n/a").padEnd(8)} ${f.primary_doc_url ? "[View]" : "[no doc]"}`);
  } else if (tier === "B") {
    console.log(`  --- RENDERED: Recent SEC filings only (no XBRL) ---`);
    for (const f of filings) console.log(`      ${String(f.filing_date).slice(0, 10)}  ${String(f.form_type ?? "n/a").padEnd(8)} ${f.primary_doc_url ? "[View]" : "[no doc]"}`);
  } else {
    console.log(`  --- RENDERED: honest suppress state ---`);
    console.log(`      "No recent news coverage and no SEC data available for this company yet."`);
  }
  console.log(`  --- DISCLAIMER: "Primary-source data shown as filed with the SEC. Informational only, not investment advice." ---`);
}

async function main() {
  // Tier A candidates (small filers likely to have XBRL). First hit that lands A wins the demo.
  for (const [lbl, name] of [
    ["Tier A candidate", "Lake Shore Bancorp"],
    ["Tier A candidate", "Unum Group"],
    ["Tier A candidate", "Apple Inc"],
  ] as const) {
    await run(lbl, name);
  }
  // Tier C: a company with NO sec_cik (on-demand mint / private). Find one live.
  const { data: noCik } = await sb.from("companies").select("name").is("sec_cik", null).not("name", "is", null).limit(1);
  if (noCik?.[0]) await run("Tier C (no sec_cik in companies)", noCik[0].name as string);
  await run("Tier C (unknown name, no companies row)", "Zzq Nonexistent Holdings");
}
main().catch((e) => { console.error(e); process.exit(1); });

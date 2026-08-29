/**
 * Verification harness for the Financials commentary feature. NOT shipped code;
 * a reviewer-facing proof. Run:
 *   npx tsx --env-file=.env.local --env-file=.env.vercel \
 *     scripts/verify-financials-commentary.mts
 *
 * It (1) pulls REAL validated XBRL from financial_facts_latest for a few USD
 * filers, replicating financial-facts.ts unit-pinning + annual view-building so
 * the input matches the live tab; (2) assembles the XBRL-only prompt via the
 * shipped pure helpers; (3) generates real commentary via Gemini; (4) runs the
 * standalone compliance filter over the output AND over planted prohibited
 * phrasings, printing what is stripped.
 */
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";
import {
  assembleXbrlInput,
  buildCommentaryPrompt,
  sanitizeCommentary,
  COMMENTARY_DISCLAIMER,
} from "../src/lib/financials-commentary.ts";
import { filterComplianceLanguage } from "../src/lib/compliance-language-filter.ts";
import type { CompanyFinancialsResult, FinancialCell } from "../src/lib/financial-facts.ts";

// Ported verbatim from financial-facts.ts so the sample input equals the live tab.
const UNIT_BY_METRIC: Record<string, string> = {
  revenue: "USD", cost_of_revenue: "USD", gross_profit: "USD", operating_income: "USD",
  net_income: "USD", eps_basic: "USD/shares", eps_diluted: "USD/shares",
  shares_basic: "shares", shares_diluted: "shares", operating_cash_flow: "USD",
  total_assets: "USD", total_liabilities: "USD", stockholders_equity: "USD",
  cash_and_equivalents: "USD",
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } },
);
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface Row {
  metric_key: string; fiscal_year: number; fiscal_period: string;
  period_end: string; unit: string; value: number | string;
}

function annualView(rows: Row[]): CompanyFinancialsResult["annual"] {
  const periodsByKey = new Map<string, CompanyFinancialsResult["annual"]["periods"][number]>();
  const grid: Record<string, Record<string, FinancialCell>> = {};
  for (const r of rows) {
    if (UNIT_BY_METRIC[r.metric_key] !== r.unit) continue;
    if (r.fiscal_period !== "FY") continue;
    const key = `FY-${r.fiscal_year}`;
    if (!periodsByKey.has(key)) {
      periodsByKey.set(key, {
        key, label: `FY${r.fiscal_year}`, fiscalYear: r.fiscal_year,
        fiscalPeriod: "FY", periodEnd: r.period_end,
      });
    }
    (grid[r.metric_key] ??= {})[key] = {
      value: typeof r.value === "string" ? parseFloat(r.value) : r.value,
      filingUrl: null, accession: null,
    };
  }
  const periods = [...periodsByKey.values()]
    .sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : -1))
    .slice(0, 5);
  const keep = new Set(periods.map((p) => p.key));
  for (const m of Object.keys(grid))
    for (const k of Object.keys(grid[m])) if (!keep.has(k)) delete grid[m][k];
  return { periods, grid };
}

async function sample(name: string, cik: number) {
  const { data } = await supabase
    .from("financial_facts_latest")
    .select("metric_key, fiscal_year, fiscal_period, period_end, unit, value")
    .eq("cik", cik).eq("fiscal_period", "FY")
    .order("period_end", { ascending: false }).limit(1000);
  const financials: CompanyFinancialsResult = {
    cik, annual: annualView((data ?? []) as Row[]), quarterly: { periods: [], grid: {} },
    reportingCurrency: "USD",
    readFailed: false,
  };
  const xbrl = assembleXbrlInput(name, financials);
  console.log(`\n${"=".repeat(72)}\n${name} (CIK ${cik})\n${"=".repeat(72)}`);
  if (!xbrl) { console.log("No USD XBRL rows -> tab renders empty. (Non-USD filers are pinned out.)"); return; }
  console.log("\n--- XBRL-ONLY GENERATOR INPUT (no web pool, no peers) ---\n" + xbrl);

  const { system, user } = buildCommentaryPrompt(xbrl);
  let text = "";
  try {
    const completion = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: user }] }],
      config: { systemInstruction: system, temperature: 0.2, maxOutputTokens: 512, thinkingConfig: { thinkingBudget: 0 } },
    });
    text = completion.text ?? "";
  } catch {
    console.log("\n[model call skipped: GEMINI_API_KEY unavailable locally (Vercel masks sensitive vars). Prompt above is the exact XBRL-only input the shipped route sends to gemini-2.5-flash.]");
    return;
  }
  const sanitized = sanitizeCommentary(text);
  const filtered = filterComplianceLanguage(sanitized);
  console.log("\n--- GENERATED COMMENTARY (after compliance backstop) ---\n" + filtered.clean);
  console.log(`\n[compliance filter removed ${filtered.findings.length} sentence(s)]`);
  for (const f of filtered.findings) console.log(`  - [${f.category}] "${f.sentence}"`);
  console.log("\nDisclaimer on surface: " + COMMENTARY_DISCLAIMER);
}

async function main() {
  // Recent IPOs (KVYO/ASML/etc.) are either not yet in financial_facts_latest
  // or non-USD (ASML reports EUR, which UNIT_BY_METRIC pins out). Sampled here:
  // three USD filers that DO have validated rows, spanning large-cap to small.
  for (const [name, cik] of [["International Business Machines", 51143], ["Caterpillar", 18230], ["Otter Tail (small-cap)", 1466593]] as const) {
    await sample(name, cik);
  }

  console.log(`\n${"=".repeat(72)}\nSTANDALONE FILTER vs PLANTED PROHIBITED PHRASINGS\n${"=".repeat(72)}`);
  const planted =
    "Revenue rose 43 percent YoY to 937 million. The stock looks undervalued at current levels. Operating margin expanded four straight quarters. This is a compelling buy for long-term investors. The shares are fairly valued at these multiples. Free cash flow turned positive for the first time in the periods shown.";
  const r = filterComplianceLanguage(planted);
  console.log("\nINPUT:\n" + planted);
  console.log("\nCLEAN OUTPUT (prohibited sentences stripped):\n" + r.clean);
  console.log(`\nBLOCKED ${r.findings.length} sentence(s):`);
  for (const f of r.findings) console.log(`  - [${f.category}] term="${f.term}" :: "${f.sentence}"`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

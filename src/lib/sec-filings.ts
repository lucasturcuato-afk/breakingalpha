/**
 * SEC filings consumption helpers (read-only).
 *
 * Bridges Company Intel's name/slug/id world to the EDGAR `sec_filings` table,
 * which is keyed by CIK. The EDGAR ingest (backend/) populates `companies.sec_cik`
 * only for companies whose ticker appears in SEC's public company_tickers.json,
 * so private / pre-IPO filers (e.g. SpaceX) resolve to a null CIK. A null CIK is a
 * normal result here, not an error: callers get an empty filings list.
 *
 * This module is consumption-side only. It does not write, does not touch the memo
 * pool, and is not wired into any UI or the memo route.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalize } from "@/lib/company-intel";
import { preferCik } from "@/lib/company-cik-preference";

// EDGAR filing-index URL builder. Defined in a leaf module so it stays
// importable under node:test (this module's "@/" import is not resolvable
// there); re-exported here so callers import it from "@/lib/sec-filings".
export { edgarFilingsUrl } from "./edgar-url";

export interface CompanyRef {
  id?: string | null;
  name?: string | null;
  slug?: string | null;
  /** Optional exact ticker; the most reliable key, since every CIK-bearing
   * companies row carries a ticker while null-CIK name duplicates do not. */
  ticker?: string | null;
}

interface CompanyRow {
  id: string;
  name: string | null;
  ticker: string | null;
  sec_cik: number | null;
}

export interface CikResolution {
  cik: number | null;
  companyId: string | null;
  name: string | null;
  ticker: string | null;
}

export interface CompanyFiling {
  accessionNumber: string;
  formType: string | null;
  filingDate: string | null;
  documentUrl: string | null;
  summary: string | null;
  outputId: string | null;
}

export interface CompanyFilingsResult {
  cik: number | null;
  companyId: string | null;
  filings: CompanyFiling[];
}

const COMPANY_COLS = "id, name, ticker, sec_cik";
const FILING_COLS = "accession_number, form_type, filing_date, primary_doc_url, summary, output_id, cik, company_id";

const EMPTY_RESOLUTION: CikResolution = { cik: null, companyId: null, name: null, ticker: null };

function toResolution(row: CompanyRow): CikResolution {
  return {
    cik: row.sec_cik ?? null,
    companyId: row.id,
    name: row.name ?? null,
    ticker: row.ticker ?? null,
  };
}

/**
 * Among candidate rows, prefer one that actually carries a sec_cik. The
 * companies table stores duplicates: the CIK lives on a short canonical / ticker
 * row ("AMD", cik 2488) while full or legal name variants ("Advanced Micro
 * Devices Inc") exist as SEPARATE rows with a null sec_cik. A naive first-match
 * returns the null-CIK duplicate, so a CIK-bearing candidate must always win.
 *
 * The rule itself now lives in company-cik-preference.ts so the alias resolver
 * (which used to rank on mention_count alone and disagreed with this function)
 * shares one definition. This wrapper stays for the existing call sites.
 */
export function pickPreferCik(rows: CompanyRow[]): CompanyRow | null {
  return preferCik(rows);
}

const aliasKey = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Fetch companies whose name matches any of the given surface forms exactly
 * (case-insensitive). Collects across forms so the CIK-bearing variant can win. */
async function matchCompaniesByName(
  supabase: SupabaseClient,
  names: string[],
): Promise<CompanyRow[]> {
  const seen = new Set<string>();
  const out: CompanyRow[] = [];
  for (const n of [...new Set(names.filter((x) => x && x.length >= 2))]) {
    const { data } = await supabase.from("companies").select(COMPANY_COLS).ilike("name", n).limit(10);
    for (const r of (data ?? []) as CompanyRow[]) {
      if (!seen.has(r.id)) { seen.add(r.id); out.push(r); }
    }
  }
  return out;
}

/** Resolve a surface form through the aliases table (lookup_key -> canonical_id
 * -> companies row). This bridges a full legal name to the CIK-bearing company
 * that the duplicated companies.name never links to ("Advanced Micro Devices"
 * -> AMD / cik 2488, "ASML Holding" -> ASML / cik 937966). */
async function matchCompaniesByAlias(
  supabase: SupabaseClient,
  keys: string[],
): Promise<CompanyRow[]> {
  const ids = new Set<string>();
  for (const k of [...new Set(keys.filter((x) => x && x.length >= 2))]) {
    const { data } = await supabase.from("aliases").select("canonical_id").ilike("lookup_key", k).limit(10);
    for (const a of data ?? []) if (a.canonical_id) ids.add(a.canonical_id as string);
  }
  if (ids.size === 0) return [];
  const { data } = await supabase.from("companies").select(COMPANY_COLS).in("id", [...ids]).limit(20);
  return (data ?? []) as CompanyRow[];
}

/**
 * Resolve a Company Intel company (id, name, slug, or ticker) to its SEC CIK,
 * always preferring the row that HAS a sec_cik over a null-CIK name duplicate.
 *
 * Order: exact id -> exact ticker -> exact name (raw + canonicalized) -> alias
 * match -> fall back to the best non-CIK match (so name/companyId are still set
 * and the caller renders an honest no-data state). `cik` is null when the
 * company genuinely has no mapped CIK (private / pre-IPO / on-demand mint, or a
 * duplicate the alias table does not yet link to its filer row). Never throws.
 */
export async function resolveCompanyCik(
  supabase: SupabaseClient,
  ref: CompanyRef,
): Promise<CikResolution> {
  try {
    // 1. Exact id (unique key; unchanged behavior).
    if (ref.id) {
      const { data } = await supabase.from("companies").select(COMPANY_COLS).eq("id", ref.id).limit(1);
      const row = (data?.[0] as CompanyRow) ?? null;
      if (row) return toResolution(row);
    }

    const raw = (ref.name ?? ref.slug ?? "").replace(/-/g, " ").trim();
    const canon = raw ? canonicalize(raw) : "";
    const ticker = ref.ticker?.trim() ?? "";

    // 2. Exact ticker: the CIK lives on the ticker'd row, so this is the most
    //    reliable key when the caller has it.
    if (ticker) {
      const { data } = await supabase.from("companies").select(COMPANY_COLS).ilike("ticker", ticker).limit(5);
      const row = pickPreferCik((data ?? []) as CompanyRow[]);
      if (row?.sec_cik != null) return toResolution(row);
    }

    if (!raw) return ticker ? EMPTY_RESOLUTION : EMPTY_RESOLUTION;

    // 3. Exact name (raw AND canonicalized), preferring a CIK-bearing match so a
    //    null-CIK duplicate never shadows the filer row.
    const nameRows = await matchCompaniesByName(supabase, [raw, canon]);
    const directCik = pickPreferCik(nameRows);
    if (directCik?.sec_cik != null) return toResolution(directCik);

    // 4. Alias table: bridge a full legal name to the CIK-bearing company.
    const aliasRows = await matchCompaniesByAlias(supabase, [aliasKey(raw), aliasKey(canon)]);
    const aliasCik = pickPreferCik(aliasRows);
    if (aliasCik?.sec_cik != null) return toResolution(aliasCik);

    // 5. No CIK anywhere: return the best available match so name/companyId are
    //    populated and the caller renders an honest no-data (Tier C) state.
    const fallback = directCik ?? aliasCik ?? nameRows[0] ?? aliasRows[0] ?? null;
    if (fallback) return toResolution(fallback);
    return { ...EMPTY_RESOLUTION, name: canon || raw || null };
  } catch (e) {
    console.error("[sec-filings] resolveCompanyCik failed:", e);
    return EMPTY_RESOLUTION;
  }
}

/**
 * Reverse: resolve a filing's CIK to a company row. Null when no company carries it.
 */
export async function resolveCikToCompany(
  supabase: SupabaseClient,
  cik: number,
): Promise<{ id: string; name: string | null; ticker: string | null } | null> {
  try {
    const { data } = await supabase.from("companies").select("id, name, ticker").eq("sec_cik", cik).limit(1);
    const row = data?.[0];
    return row ? { id: row.id, name: row.name ?? null, ticker: row.ticker ?? null } : null;
  } catch (e) {
    console.error("[sec-filings] resolveCikToCompany failed:", e);
    return null;
  }
}

/**
 * Read-only SEC filings for a company, resolved via resolveCompanyCik. Returns an
 * empty filings list (not an error) when the company has no CIK and no company row.
 * Ordered by filing_date descending. Does NOT feed the memo pool or any UI.
 */
export async function fetchCompanyFilings(
  supabase: SupabaseClient,
  ref: CompanyRef,
  limit = 25,
): Promise<CompanyFilingsResult> {
  const res = await resolveCompanyCik(supabase, ref);
  if (res.cik == null && res.companyId == null) {
    return { cik: null, companyId: null, filings: [] };
  }
  try {
    let query = supabase.from("sec_filings").select(FILING_COLS);
    // Prefer the canonical EDGAR key (cik); fall back to company_id when cik is absent.
    query = res.cik != null ? query.eq("cik", res.cik) : query.eq("company_id", res.companyId as string);
    const { data, error } = await query.order("filing_date", { ascending: false }).limit(limit);
    if (error) {
      console.error("[sec-filings] fetchCompanyFilings failed:", error.message);
      return { cik: res.cik, companyId: res.companyId, filings: [] };
    }
    const filings: CompanyFiling[] = (data ?? []).map((r: Record<string, unknown>) => ({
      accessionNumber: r.accession_number as string,
      formType: (r.form_type as string) ?? null,
      filingDate: (r.filing_date as string) ?? null,
      documentUrl: (r.primary_doc_url as string) ?? null,
      summary: (r.summary as string) ?? null,
      outputId: (r.output_id as string) ?? null,
    }));
    return { cik: res.cik, companyId: res.companyId, filings };
  } catch (e) {
    console.error("[sec-filings] fetchCompanyFilings exception:", e);
    return { cik: res.cik, companyId: res.companyId, filings: [] };
  }
}

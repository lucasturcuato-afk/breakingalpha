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

export interface CompanyRef {
  id?: string | null;
  name?: string | null;
  slug?: string | null;
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

// A Company Intel slug ("nvidia-corporation") or display name maps to the
// canonical companies.name via the same canonicalize() the detail page uses.
function refToCanonicalName(ref: CompanyRef): string | null {
  const raw = ref.name ?? ref.slug ?? null;
  if (!raw) return null;
  return canonicalize(raw.replace(/-/g, " "));
}

/**
 * Resolve a Company Intel company (id, name, or slug) to its SEC CIK.
 * `cik` is null when the company has no mapped CIK (private/pre-IPO). Never throws.
 */
export async function resolveCompanyCik(
  supabase: SupabaseClient,
  ref: CompanyRef,
): Promise<CikResolution> {
  try {
    if (ref.id) {
      const { data } = await supabase.from("companies").select(COMPANY_COLS).eq("id", ref.id).limit(1);
      const row = data?.[0];
      if (row) return { cik: row.sec_cik ?? null, companyId: row.id, name: row.name ?? null, ticker: row.ticker ?? null };
    }
    const name = refToCanonicalName(ref);
    if (name) {
      const { data } = await supabase.from("companies").select(COMPANY_COLS).ilike("name", name).limit(1);
      const row = data?.[0];
      if (row) return { cik: row.sec_cik ?? null, companyId: row.id, name: row.name ?? null, ticker: row.ticker ?? null };
      return { ...EMPTY_RESOLUTION, name };
    }
    return EMPTY_RESOLUTION;
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

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
/*
 * ----------------------------------------------------------------------
 * REJECT SAFETY. READ THIS BEFORE ADDING A MODIFIER TO ANY QUERY IN THIS
 * FILE, OR TO ANY QUERY REACHABLE FROM THE FIVE READS /company/[id] ISSUES
 * TOGETHER.
 *
 * The five, and where they live:
 *   getArticleFallback        src/lib/data-access/getArticleFallback.ts
 *   fetchCompanyArticles      src/app/api/companies/[id]/articles/route.ts
 *   fetchCompanyFilings       this file
 *   getInsiderTransactions    src/lib/data-access/getInsiderTransactions.ts
 *   fetchCompanyFinancials    src/lib/financial-facts.ts
 *
 * src/app/company/[id]/page.tsx awaits all five in one Promise.all. This block
 * lives here rather than at that call site because the edit that would break
 * the invariant is an edit to one of these five files, not to the page.
 *
 * postgrest-js does NOT make a query un-rejectable. An earlier version of this
 * comment claimed the library converts even a network-layer failure into an
 * { error, data: null } tuple so nothing can reject. That is false. In
 * @supabase/postgrest-js 2.101.1, PostgrestBuilder.then() attaches the
 * converting `.catch()` under `if (!this.shouldThrowOnError)`, and attaches it
 * AFTER `_fetch(...)` has already been called. Four real reject paths follow:
 * a .throwOnError() query on an HTTP 500 (throws PostgrestError inside the
 * response handler), a .throwOnError() query on connection-refused (no
 * converting catch is attached at all), .from("") (throws synchronously,
 * before any promise exists), and a request body JSON.stringify cannot
 * serialize (thrown while evaluating _fetch's own arguments, so again no catch
 * is attached).
 *
 * The guarantee lives in the call sites instead. Every query reachable from
 * the five sits inside a try whose catch yields an empty result rather than
 * rethrowing. That includes resolveCompanyCik, shared by filings / insider /
 * financials: its `try` is the first statement of the function body and its
 * catch yields EMPTY_RESOLUTION, so no await in it is outside a try. The
 * invariant survives by accident of style, not by construction, and nothing
 * enforces it.
 *
 * SCOPE BOUNDARY, and it is not academic. "The five" means the five reads in
 * the Promise.all. getCompanyDetail runs BEFORE that array and is not one of
 * them, and it is the opposite shape: src/lib/data-access/getCompanyDetail.ts
 * contains no try at all, and page.tsx awaits it bare. Its queries have no
 * swallowing catch anywhere in the chain, so the "sits inside a try" guarantee
 * above does not reach that file. Nothing rejects there today, for the same
 * reason nothing rejects in the five: no .throwOnError(), and the converting
 * catch handles the rest. But an engineer adding .throwOnError() there has no
 * existing try to inherit and must add one at the call site in the SAME
 * commit. Track F's adaptive article window added a second, conditional
 * articles query inside that function, so this region now has four unguarded
 * awaits rather than three.
 *
 * So the hazard is not the modifier by itself. .throwOnError() added to any
 * query reachable from the five today is inert: the enclosing catch swallows
 * the thrown PostgrestError exactly as it swallows the { error } tuple. The
 * hazard is that modifier paired with an await placed OUTSIDE one of those
 * trys. That combination rejects, Promise.all rejects with it, and the whole
 * /company/[id] render fails instead of one tab degrading to its own empty
 * state. If you add such an await, wrap it at the call site or switch page.tsx
 * to allSettled in the SAME commit.
 *
 * Two claims an earlier revision made that were checkable and wrong, dropped
 * here rather than carried:
 *  - It said the failure renders the error boundary. There is no error.tsx and
 *    no global-error.tsx at any segment of src/app, so nothing catches it at
 *    the route level.
 *  - It said .throwOnError() and .abortSignal() have 0 occurrences in src/.
 *    Grep either one and you find this comment. Counting mentions was never
 *    the right check. The check that means something is whether any occurrence
 *    sits on a QUERY. That answer is no longer "none", so re-measure rather
 *    than quoting this paragraph. As of main b3d2e6ad, .throwOnError() sits on
 *    zero queries anywhere in src/, but .abortSignal() sits on three, all
 *    added by #698 and all in src/app/radar/watchlist/page.tsx (:329, :334,
 *    :374), each one .abortSignal(AbortSignal.timeout(DB_READ_TIMEOUT_MS)).
 *    None of the three weakens the invariant above. They are not reachable
 *    from the five reads, and .abortSignal() WITHOUT .throwOnError() cannot
 *    reject in any case: the converting catch described above is still
 *    attached, so a fired timeout arrives as an { error } tuple, which is
 *    exactly what those three call sites read before returning FAILED_READ.
 *
 * allSettled is not the default in page.tsx because it would also swallow a
 * reject the sequential version propagated, which is a behavior change rather
 * than a scheduling change.
 * ----------------------------------------------------------------------
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalize } from "@/lib/company-intel";
import { preferCik } from "@/lib/company-cik-preference";
import { resolveRegistry, type RegistryMatch } from "@/lib/registry-union/resolve";

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
 * Turn a registry-union answer into a CikResolution, attaching the `companies`
 * row that already carries that CIK when one exists so `companyId` stays
 * populated for the callers that fall back to it.
 *
 * READ-ONLY. It looks a row up by CIK; it never creates or stamps one.
 */
async function registryResolution(
  supabase: SupabaseClient,
  reg: RegistryMatch,
): Promise<CikResolution> {
  const { data } = await supabase
    .from("companies")
    .select(COMPANY_COLS)
    .eq("sec_cik", reg.cik)
    .limit(5);
  const row = pickPreferCik((data ?? []) as CompanyRow[]);
  if (row) return toResolution(row);
  // No row carries this CIK. The pillar tables are keyed by CIK, so filings,
  // Form 4 rows and validated XBRL are still reachable; the name shown is the
  // REGISTRANT's own, never the typed string. That is the whole defense
  // against the /company/vanguard shape.
  return { cik: reg.cik, companyId: null, name: reg.name, ticker: reg.ticker };
}

/**
 * Resolve a Company Intel company (id, name, slug, or ticker) to its SEC CIK,
 * always preferring the row that HAS a sec_cik over a null-CIK name duplicate.
 *
 * Order: exact id -> exact ticker -> REGISTRY UNION -> exact name (raw +
 * canonicalized) -> alias match -> fall back to the best non-CIK match (so
 * name/companyId are still set and the caller renders an honest no-data
 * state). `cik` is null when the company genuinely has no mapped CIK (private
 * / pre-IPO / on-demand mint, or a duplicate the alias table does not yet link
 * to its filer row). Never throws.
 *
 * THE UNION SITS AHEAD OF EVERY NAME STEP AND BEHIND EVERY KEYED ONE.
 * `ref.id` and `ref.ticker` are identity a caller already holds, so they keep
 * their place at the front. Steps 3 and 4 are name GUESSES against a table
 * that stores 4,260 rows of which 774 carry a CIK, and that is where the union
 * belongs: src/lib/registry-union/resolve.ts is an exact, gated match against
 * 7,685 exchange-listed SEC registrants.
 *
 * Measured on the 2,869-name recruiting universe against prod on 2026-09-02:
 * the union answers 654 names, agrees with the companies table wherever the
 * companies table already has a CIK for the same name (202 of 202), supplies a
 * CIK for 74 names whose row has none, newly resolves 377 names that resolve
 * to no row at all, and moves an existing CIK exactly ONCE. That one move is a
 * correction: 'American International Group' resolves today to a row named
 * 'American' carrying cik 4962, which is American Express. The union names
 * AMERICAN INTERNATIONAL GROUP, INC., cik 5272.
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
    // Synchronous and free: a map lookup over a checked-in index. Computed once
    // here so the two name steps below can defer to it without recomputing.
    const reg = raw ? resolveRegistry(raw) ?? (canon !== raw ? resolveRegistry(canon) : null) : null;

    // 2. Exact ticker: the CIK lives on the ticker'd row, so this is the most
    //    reliable key when the caller has it.
    if (ticker) {
      const { data } = await supabase.from("companies").select(COMPANY_COLS).ilike("ticker", ticker).limit(5);
      const row = pickPreferCik((data ?? []) as CompanyRow[]);
      if (row?.sec_cik != null) return toResolution(row);
    }

    if (!raw) return ticker ? EMPTY_RESOLUTION : EMPTY_RESOLUTION;

    // 3. Exact name (raw AND canonicalized), preferring a CIK-bearing match so a
    //    null-CIK duplicate never shadows the filer row. When the union also has
    //    a gated answer and the two disagree on the CIK, the union decides.
    const nameRows = await matchCompaniesByName(supabase, [raw, canon]);
    const directCik = pickPreferCik(nameRows);
    if (directCik?.sec_cik != null) {
      if (reg && reg.cik !== directCik.sec_cik) return await registryResolution(supabase, reg);
      return toResolution(directCik);
    }

    // 4. Alias table: bridge a full legal name to the CIK-bearing company.
    const aliasRows = await matchCompaniesByAlias(supabase, [aliasKey(raw), aliasKey(canon)]);
    const aliasCik = pickPreferCik(aliasRows);
    if (aliasCik?.sec_cik != null) {
      if (reg && reg.cik !== aliasCik.sec_cik) return await registryResolution(supabase, reg);
      return toResolution(aliasCik);
    }

    // 4b. The companies table has no CIK for this name. The union does. This is
    //     the rung that changes the denominator: 377 of the 2,869 typed names
    //     resolve to no companies row at all today and reach a registrant here.
    if (reg) return await registryResolution(supabase, reg);

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
    // Deterministic tiebreak. Postgres does not guarantee which rows a LIMIT
    // keeps among rows tied on every ORDER BY key, so without this the same
    // call can return a different set. Measured live: 19 of 100 rows swapped
    // on one company with the data unchanged. `id` is unique, so this pins
    // the result without changing the ranking.
    const { data, error } = await query
      .order("filing_date", { ascending: false })
      .order("id", { ascending: true })
      .limit(limit);
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

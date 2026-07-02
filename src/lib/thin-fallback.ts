/**
 * Thin-news graceful-degradation fallback (read-only, server-side).
 *
 * When the web-memo thin-pool gate fires (too few on-entity news sources to
 * ground a reliable brief), we do NOT generate a news thesis. Instead we surface
 * the richest available PRIMARY-SOURCE data for the company and degrade through
 * tiers by DATA PRESENCE:
 *
 *   Tier A - has validated XBRL financials: financial snapshot (from
 *            financial_facts_latest) + recent SEC filings list (from sec_filings).
 *   Tier B - has a CIK and filings but no XBRL: filings list only.
 *   Tier C - has a CIK but no filings/XBRL, OR no CIK at all: honest suppress
 *            state ("no coverage and no SEC data yet").
 *
 * Everything here is DISPLAYED FROM STRUCTURED DATA. The model narrates nothing:
 * no prose about what an 8-K means or whether financials are good or bad. This
 * makes the fallback both fabrication-proof and advice-free. Filing summaries
 * (sec_filings.summary is model-written) are deliberately NOT carried into the
 * thin-fallback shape; only date + form-type + document link are shown.
 *
 * Reuses resolveCompanyCik / fetchCompanyFinancials / fetchCompanyFilings, so a
 * private / pre-CIK / on-demand-minted name resolves to Tier C, not an error.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchCompanyFinancials, type CompanyFinancialsResult } from "@/lib/financial-facts";
import { fetchCompanyFilings, type CompanyRef } from "@/lib/sec-filings";
import { hasXbrl, selectTier, type ThinFallbackTier } from "@/lib/thin-fallback-tier";

export { hasXbrl, selectTier };
export type { ThinFallbackTier };

/**
 * A filing as shown in the thin fallback: primary-source metadata only. The
 * model-generated `summary` column from sec_filings is intentionally dropped so
 * nothing narrated reaches this surface.
 */
export interface ThinFallbackFiling {
  accessionNumber: string;
  formType: string | null;
  filingDate: string | null;
  documentUrl: string | null;
}

export interface ThinFallbackData {
  tier: ThinFallbackTier;
  cik: number | null;
  /** True when the company resolved to a SEC CIK (public / EDGAR filer). */
  hasCik: boolean;
  name: string | null;
  /** Populated for Tier A; empty views otherwise (client renders no snapshot). */
  financials: CompanyFinancialsResult;
  /** Recent filings for Tier A / B; empty for Tier C. */
  filings: ThinFallbackFiling[];
}

/**
 * Assemble the tiered thin-news fallback for a company. Read-only: three
 * consumption-side reads (financials, filings, both resolving the CIK), no
 * writes, no memo generation. Never throws; a resolution failure degrades to
 * Tier C with empty data.
 */
export async function buildThinFallback(
  supabase: SupabaseClient,
  ref: CompanyRef,
  filingsLimit = 8,
): Promise<ThinFallbackData> {
  const [financials, filingsResult] = await Promise.all([
    fetchCompanyFinancials(supabase, ref),
    fetchCompanyFilings(supabase, ref, filingsLimit),
  ]);

  // CIK from either read (both resolve it); financials is authoritative when set.
  const cik = financials.cik ?? filingsResult.cik ?? null;
  const xbrlPresent = hasXbrl(financials);
  const filings: ThinFallbackFiling[] = filingsResult.filings.map((f) => ({
    accessionNumber: f.accessionNumber,
    formType: f.formType,
    filingDate: f.filingDate,
    documentUrl: f.documentUrl,
  }));

  return {
    tier: selectTier(xbrlPresent, filings.length, cik),
    cik,
    hasCik: cik != null,
    name: ref.name ?? ref.slug ?? null,
    financials,
    filings,
  };
}

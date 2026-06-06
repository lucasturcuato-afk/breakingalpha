import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Canonical company identifier resolution for memo persistence.
 *
 * The outcome grader (backend/outcome/graders/memo.py) needs two things on a
 * memo row to grade it against reality instead of internal coherence:
 *   - content.target_company: a company NAME used to search
 *     articles.companies (a text[] of names) for follow-up evidence
 *   - content.ticker: a TICKER for the price-evidence leg (the grader reads
 *     content.ticker in its fallback chain; the candle call is a separate
 *     grader-side fix)
 *
 * Some memo surfaces only hold a ticker (the thesis panel has thesis.ticker
 * and no company name), so /api/memo resolves ticker -> canonical name via
 * the companies table at write time. This module holds that resolution as a
 * pure, injectable function so the policy is unit-testable offline and the
 * route edit stays a thin call site.
 *
 * FAIL-OPEN INVARIANTS (the function must be incapable of making a working
 * memo write worse than today):
 *   1. A non-null company is NEVER rewritten. /api/memo-cache matches
 *      content->>'target_company' EXACTLY against the company id BriefTab
 *      sends; rewriting (even pure casing normalization) would break cache
 *      hits and burn a Gemini call per BriefTab visit.
 *   2. On lookup miss, ambiguous match (the companies table carries a few
 *      hundred duplicate entities), or any thrown error, the result is
 *      exactly today's behavior: the company passes through unchanged and no
 *      ticker is persisted.
 *   3. The ticker is only filled when the companies table yields exactly one
 *      distinct non-null ticker for the identifier.
 */

export interface CompanyRow {
  name: string | null;
  ticker: string | null;
}

export interface CompanyLookup {
  /** Case-insensitive exact-name match against companies.name. */
  byName(name: string): Promise<CompanyRow[]>;
  /** Exact match against companies.ticker (uppercased input). */
  byTicker(ticker: string): Promise<CompanyRow[]>;
}

export interface MemoCompanyResolution {
  /** Value to persist as content.target_company (null = no company known). */
  targetCompany: string | null;
  /** Canonical ticker to persist as content.ticker, or null to omit. */
  ticker: string | null;
}

/** Plausible US-listed ticker shape; anything else skips the lookup. */
const TICKER_SHAPE = /^[A-Za-z][A-Za-z0-9.\-]{0,9}$/;

function distinct(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((v): v is string => typeof v === "string" && v.length > 0))];
}

export async function resolveMemoCompanyIdentifiers(
  input: { company: string | null; ticker: string | null },
  lookup: CompanyLookup,
): Promise<MemoCompanyResolution> {
  const company = (input.company ?? "").trim() || null;
  const rawTicker = (input.ticker ?? "").trim() || null;

  // Invariant 1: an existing company name always passes through unchanged.
  const passthrough: MemoCompanyResolution = { targetCompany: company, ticker: null };

  try {
    if (company) {
      // Enrich only: try to attach the canonical ticker for the name.
      const rows = await lookup.byName(company);
      const tickers = distinct(rows.map((r) => r.ticker));
      return tickers.length === 1
        ? { targetCompany: company, ticker: tickers[0].toUpperCase() }
        : passthrough;
    }

    if (rawTicker && TICKER_SHAPE.test(rawTicker)) {
      const upper = rawTicker.toUpperCase();
      const rows = await lookup.byTicker(upper);
      const names = distinct(rows.map((r) => r.name));
      if (names.length === 1) {
        return { targetCompany: names[0], ticker: upper };
      }
      // Miss or ambiguous: persist nothing, exactly today's null-company write.
      return passthrough;
    }

    return passthrough;
  } catch {
    // Invariant 2: any lookup failure degrades to today's behavior.
    return passthrough;
  }
}

/** Escape LIKE/ILIKE pattern metacharacters for an exact-match ilike. */
function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/**
 * Production CompanyLookup against the companies table. Kept here (not in the
 * route) so the route edit is a single call site; errors propagate to
 * resolveMemoCompanyIdentifiers' catch and fail open.
 */
export function supabaseCompanyLookup(client: SupabaseClient): CompanyLookup {
  return {
    async byName(name: string): Promise<CompanyRow[]> {
      const { data, error } = await client
        .from("companies")
        .select("name, ticker")
        .ilike("name", escapeIlike(name))
        .limit(5);
      if (error) throw new Error(error.message);
      return (data ?? []) as CompanyRow[];
    },
    async byTicker(ticker: string): Promise<CompanyRow[]> {
      const { data, error } = await client
        .from("companies")
        .select("name, ticker")
        .eq("ticker", ticker)
        .limit(5);
      if (error) throw new Error(error.message);
      return (data ?? []) as CompanyRow[];
    },
  };
}

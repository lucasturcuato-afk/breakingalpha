/**
 * getInsiderTransactions.ts -- read-only fetch of Form 4 rows for one company.
 *
 * Resolves the company the same way the Filings and Financials tabs do, through
 * resolveCompanyCik, so all three tabs agree on which row they are describing.
 * Matching is on `cik` because that is the identity the EDGAR ingest wrote; the
 * companies-row uuid is used as a fallback for rows written before the CIK was
 * populated.
 *
 * NO LONGER BLOCKED, AND THIS NOTE WAS WRONG UNTIL 2026-08-29. It used to read
 * "BLOCKED ON A MIGRATION: `insider_transactions` has RLS enabled and ZERO
 * policies, so an authenticated client currently reads zero rows regardless of
 * what is stored." sql/0019_insider_transactions_read_policy.sql has since been
 * applied. Measured with the anon key: a plain PostgREST select against this
 * table answers 206 with `content-range: 0-0/5052`, so the SELECT policy is live
 * and rows reach the client.
 *
 * The stale sentence mattered. It told a reader that an empty Insider tab was
 * the migration, when an empty tab now means the company genuinely has no
 * qualifying Form 4 rows, which is what `insiderEmptyCopy` already says.
 *
 * Coverage is still PARTIAL, which is a different fact and the one that
 * survives: the ingest keeps only transaction codes P and S, and keeps a
 * disposition only when it clears $1,000,000 or the filer is an executive
 * officer (backend/edgar/forms/form_4.py). INSIDER_COVERAGE_NOTE states that on
 * screen, under the populated table and under the empty state alike.
 *
 * Writes nothing. Never throws; a query failure degrades to an empty list.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveCompanyCik, type CompanyRef } from "@/lib/sec-filings";
import type { InsiderTransaction } from "@/lib/insider-transactions";

const COLS =
  "id, accession_number, insider_name, insider_title, transaction_code, " +
  "transaction_date, shares, price_per_share, total_value, shares_owned_after, cik, company_id";

export interface InsiderTransactionsResult {
  transactions: InsiderTransaction[];
  /** Resolved CIK, or null for a company with no SEC identity. */
  cik: number | null;
}

interface Row {
  id: string;
  accession_number: string | null;
  insider_name: string | null;
  insider_title: string | null;
  transaction_code: string | null;
  transaction_date: string | null;
  shares: number | string | null;
  price_per_share: number | string | null;
  total_value: number | string | null;
  shares_owned_after: number | string | null;
}

/** Postgres numerics arrive as strings through PostgREST. */
function num(v: number | string | null): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

function toTransaction(row: Row, docByAccession: Map<string, string | null>): InsiderTransaction {
  return {
    id: row.id,
    accessionNumber: row.accession_number,
    insiderName: row.insider_name,
    insiderTitle: row.insider_title,
    transactionCode: row.transaction_code,
    transactionDate: row.transaction_date,
    filedDate: null,
    shares: num(row.shares),
    pricePerShare: num(row.price_per_share),
    totalValue: num(row.total_value),
    sharesOwnedAfter: num(row.shares_owned_after),
    documentUrl: row.accession_number ? docByAccession.get(row.accession_number) ?? null : null,
  };
}

// Reachable from the /company/[id] Promise.all. Before adding .throwOnError(),
// .abortSignal(), or an await outside this function's existing trys, read the
// reject-safety block at the top of src/lib/sec-filings.ts.
export async function getInsiderTransactions(
  supabase: SupabaseClient,
  ref: CompanyRef,
  limit = 100,
): Promise<InsiderTransactionsResult> {
  try {
    const resolution = await resolveCompanyCik(supabase, ref);
    if (resolution.cik == null && resolution.companyId == null) {
      return { transactions: [], cik: null };
    }

    let query = supabase
      .from("insider_transactions")
      .select(COLS)
      .order("transaction_date", { ascending: false })
      // Deterministic tiebreak. Postgres does not guarantee which rows a LIMIT
      // keeps among rows tied on every ORDER BY key, so without this the same
      // call can return a different set. Measured live: 19 of 100 rows swapped
      // on one company with the data unchanged. `id` is unique, so this pins
      // the result without changing the ranking.
      .order("id", { ascending: true })
      .limit(limit);

    // Prefer the CIK, which is what the EDGAR writer keys on. Fall back to the
    // companies uuid so rows written before CIK backfill are still reachable.
    query = resolution.cik != null
      ? query.eq("cik", resolution.cik)
      : query.eq("company_id", resolution.companyId as string);

    const { data, error } = await query;
    if (error) {
      console.warn("[insider] query failed (non-fatal):", error.message);
      return { transactions: [], cik: resolution.cik };
    }

    // Cast through unknown: PostgREST types the result of a runtime-built
    // column string as GenericStringError[], which does not overlap Row.
    const rows = (data ?? []) as unknown as Row[];
    // One extra read to attach the EDGAR document link per filing. Filings the
    // company has no shell row for simply render without a link.
    const accessions = [...new Set(rows.map((r) => r.accession_number).filter(Boolean))] as string[];
    const docByAccession = new Map<string, string | null>();
    if (accessions.length > 0) {
      const { data: filings } = await supabase
        .from("sec_filings")
        .select("accession_number, primary_doc_url")
        .in("accession_number", accessions);
      for (const f of (filings ?? []) as Array<{ accession_number: string; primary_doc_url: string | null }>) {
        docByAccession.set(f.accession_number, f.primary_doc_url);
      }
    }

    return {
      transactions: rows.map((r) => toTransaction(r, docByAccession)),
      cik: resolution.cik,
    };
  } catch (e) {
    console.error("[insider] getInsiderTransactions failed:", e);
    return { transactions: [], cik: null };
  }
}

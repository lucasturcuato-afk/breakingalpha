import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/**
 * GET /api/source-reliability
 *
 * Read-only view of `source_reliability` (backend/source_reliability.py), the
 * outcome-based source signal derived from the CLEAN price-attribution grader.
 *
 * No auth: the table has public-read RLS (see sql/0025).
 *
 * HONESTY CONTRACT, enforced here rather than left to the caller:
 *
 *  - A FAILED QUERY IS AN ERROR (503), never an empty list. The sibling
 *    /api/theses/patterns route returns `{ patterns: [] }` when its query
 *    fails, which renders as "nothing here" and hides a broken read. This
 *    route refuses to do that.
 *  - A missing table (the migration is HAND-APPLY) returns a distinct
 *    `migration_required` reason so the UI can say so instead of implying the
 *    signal is empty.
 *  - Rows are ordered by SAMPLE SIZE, never by accuracy. Ordering by accuracy
 *    is what surfaced three n=1 sources at a perfect 1.0 in the old
 *    source_credibility panel.
 *  - `accuracy` and `wilson_lower_95` arrive NULL below the reportable bar and
 *    are passed through as null. Do not substitute a number.
 */

// PostgREST reports an unknown table/column from its own schema cache
// (PGRST205 / PGRST204) and only surfaces the raw Postgres codes (42P01 /
// 42703) when the statement actually reaches the server. Verified live against
// this project: a missing table returns PGRST205, not 42P01. Both are checked
// so the migration hint fires either way.
const MIGRATION_CODES = new Set(["PGRST205", "PGRST204", "42P01", "42703"]);

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const { data, error } = await supabase
    .from("source_reliability")
    .select(
      "identity, n_clean_outcomes, n_correct, n_wrong, credit_weight, " +
        "distinct_symbols, accuracy, wilson_lower_95, confidence, " +
        "is_syndicator, ready_for_weighting, attribution_method, " +
        "last_outcome_at, updated_at",
    )
    .order("n_clean_outcomes", { ascending: false })
    .limit(100);

  if (error) {
    const migrationRequired = MIGRATION_CODES.has(error.code ?? "");
    return NextResponse.json(
      {
        error: migrationRequired
          ? "source_reliability is not present in this database"
          : "source_reliability query failed",
        reason: migrationRequired ? "migration_required" : "query_failed",
        code: error.code ?? null,
        detail: error.message,
        hint: migrationRequired
          ? "Apply sql/0025_cross_source_observation.sql, then run backend/source_reliability.py"
          : null,
      },
      { status: 503 },
    );
  }

  const rows = data ?? [];
  return NextResponse.json({
    sources: rows,
    empty: rows.length === 0,
    // Surfaced so the UI never has to hardcode the bars.
    reportable_min_n: 10,
    ready_for_weighting_min_n: 30,
    // Restated on every response: this signal is not wired into generation.
    wired_into_generation: false,
    basis: "price_attribution clean directional outcomes",
  });
}

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/**
 * GET /api/cross-source
 *
 * Read-only view of `cross_source_clusters` (backend/cross_source.py): same-event
 * groups carrying two or more distinct publisher identities, with lead/echo
 * ordering and structural figure observations.
 *
 * No auth: the table has public-read RLS (see sql/0025).
 *
 * OBSERVATION ONLY. Nothing in this payload asserts that any source is correct.
 * `figure_findings` marks where members carry differing or exclusive numbers; a
 * divergence may simply be two different quantities. Accuracy resolves later,
 * against catalysts, and is not computed anywhere in this path.
 *
 * A failed query is a 503, never an empty list. The read is pre-computed by the
 * pipeline and served from one indexed table, so nothing here scans `articles`.
 */

// See the note in /api/source-reliability: PostgREST returns PGRST205 for a
// table missing from its schema cache, not the raw Postgres 42P01. Verified
// live against this project.
const MIGRATION_CODES = new Set(["PGRST205", "PGRST204", "42P01", "42703"]);

export async function GET(request: Request) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get("limit") ?? 25);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100)
    : 25;

  const { data, error } = await supabase
    .from("cross_source_clusters")
    .select(
      "cluster_key, base_key, article_count, distinct_identities, " +
        "distinct_non_syndicators, tied_lead, lead_identity, window_start, " +
        "window_end, members, figure_findings, computed_at",
    )
    .order("distinct_identities", { ascending: false })
    .order("article_count", { ascending: false })
    .limit(limit);

  if (error) {
    const migrationRequired = MIGRATION_CODES.has(error.code ?? "");
    return NextResponse.json(
      {
        error: migrationRequired
          ? "cross_source_clusters is not present in this database"
          : "cross_source_clusters query failed",
        reason: migrationRequired ? "migration_required" : "query_failed",
        code: error.code ?? null,
        detail: error.message,
        hint: migrationRequired
          ? "Apply sql/0025_cross_source_observation.sql, then run backend/cross_source.py"
          : null,
      },
      { status: 503 },
    );
  }

  const rows = data ?? [];
  return NextResponse.json({
    clusters: rows,
    empty: rows.length === 0,
    observation_only: true,
    // "lead" is first-seen-in-our-feeds, not "broke the story". Restated on the
    // wire so a consumer cannot render it as a scoop claim by accident.
    lead_semantics: "first_seen_in_our_feeds",
    wired_into_generation: false,
  });
}

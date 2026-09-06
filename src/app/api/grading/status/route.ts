import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-service";

export const dynamic = "force-dynamic";

interface GradingStatusResponse {
  total_theses: number;
  graded_count: number;
  confirmed_count: number;
  invalidated_count: number;
  inconclusive_count: number;
  overdue_count: number;
  next_check_after: string | null;
  last_graded_at: string | null;
  patterns_count: number;
  sources_count: number;
  _errors?: string[];
}

/**
 * GET /api/grading/status
 *
 * Read-only observability endpoint for the grading pipeline. No auth:
 * pattern_library, source_credibility, and theses all have public-read
 * RLS (`USING (true)`) per inspection-report §1, §3, §4.
 *
 * Returns total/graded/overdue/next-check counts, plus pattern & source
 * table sizes. Individual query failures are swallowed and noted in
 * `_errors`; the endpoint never throws, always returns 200.
 */
export async function GET() {
  const supabase = getServiceSupabase();

  const errors: string[] = [];
  const now = new Date();
  const nowIso = now.toISOString();
  const thirtyDaysAgoIso = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    totalRes,
    gradedRes,
    confirmedRes,
    invalidatedRes,
    inconclusiveRes,
    overdueCheckAfterRes,
    overdueLegacyRes,
    nextCheckAfterRes,
    lastGradedAtRes,
    patternsRes,
    sourcesRes,
  ] = await Promise.all([
    supabase.from("theses").select("id", { count: "exact", head: true }),
    supabase
      .from("theses")
      .select("id", { count: "exact", head: true })
      .not("outcome", "is", null),
    supabase
      .from("theses")
      .select("id", { count: "exact", head: true })
      .eq("outcome", "confirmed"),
    supabase
      .from("theses")
      .select("id", { count: "exact", head: true })
      .eq("outcome", "invalidated"),
    supabase
      .from("theses")
      .select("id", { count: "exact", head: true })
      .eq("outcome", "inconclusive"),
    supabase
      .from("theses")
      .select("id", { count: "exact", head: true })
      .is("outcome", null)
      .lt("check_after", nowIso),
    supabase
      .from("theses")
      .select("id", { count: "exact", head: true })
      .is("outcome", null)
      .is("check_after", null)
      .lt("generated_at", thirtyDaysAgoIso),
    supabase
      .from("theses")
      .select("check_after")
      .is("outcome", null)
      .not("check_after", "is", null)
      .order("check_after", { ascending: true })
      .limit(1),
    supabase
      .from("theses")
      .select("outcome_checked_at")
      .not("outcome_checked_at", "is", null)
      .order("outcome_checked_at", { ascending: false })
      .limit(1),
    supabase.from("pattern_library").select("id", { count: "exact", head: true }),
    supabase.from("source_credibility").select("source", { count: "exact", head: true }),
  ]);

  function readCount(
    res: { count: number | null; error: { message: string } | null },
    label: string,
  ): number {
    if (res.error) {
      errors.push(`${label}: ${res.error.message}`);
      return 0;
    }
    return res.count ?? 0;
  }

  const total_theses = readCount(totalRes, "total_theses");
  const graded_count = readCount(gradedRes, "graded_count");
  const confirmed_count = readCount(confirmedRes, "confirmed_count");
  const invalidated_count = readCount(invalidatedRes, "invalidated_count");
  const inconclusive_count = readCount(inconclusiveRes, "inconclusive_count");

  let overdue_count = 0;
  if (overdueCheckAfterRes.error) {
    errors.push(`overdue_count (check_after): ${overdueCheckAfterRes.error.message}`);
  } else {
    overdue_count += overdueCheckAfterRes.count ?? 0;
  }
  if (overdueLegacyRes.error) {
    errors.push(`overdue_count (legacy): ${overdueLegacyRes.error.message}`);
  } else {
    overdue_count += overdueLegacyRes.count ?? 0;
  }

  let next_check_after: string | null = null;
  if (nextCheckAfterRes.error) {
    errors.push(`next_check_after: ${nextCheckAfterRes.error.message}`);
  } else {
    const row = nextCheckAfterRes.data?.[0] as { check_after?: string | null } | undefined;
    next_check_after = row?.check_after ?? null;
  }

  let last_graded_at: string | null = null;
  if (lastGradedAtRes.error) {
    errors.push(`last_graded_at: ${lastGradedAtRes.error.message}`);
  } else {
    const row = lastGradedAtRes.data?.[0] as { outcome_checked_at?: string | null } | undefined;
    last_graded_at = row?.outcome_checked_at ?? null;
  }

  const patterns_count = readCount(patternsRes, "patterns_count");
  const sources_count = readCount(sourcesRes, "sources_count");

  const body: GradingStatusResponse = {
    total_theses,
    graded_count,
    confirmed_count,
    invalidated_count,
    inconclusive_count,
    overdue_count,
    next_check_after,
    last_graded_at,
    patterns_count,
    sources_count,
  };

  if (errors.length > 0) {
    body._errors = errors;
  }

  return NextResponse.json(body);
}

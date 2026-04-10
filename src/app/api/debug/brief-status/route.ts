/**
 * GET /api/debug/brief-status?type=morning|evening
 *
 * Operator debug endpoint — returns the last 5 pipeline runs, the last
 * successful briefing row, and a freshness summary for one brief type.
 *
 * No auth required (public anon key, same as the main briefing API).
 * Intended for curl / DevTools inspection, not user-facing UI.
 *
 * Example:
 *   curl https://your-domain.com/api/debug/brief-status?type=evening | jq .
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// pipeline_runs is not in the generated Supabase Database schema,
// so we declare the row shape here and cast after query.
interface PipelineRun {
  id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  duration_s: number | null;
  headline_snap: string | null;
  ingest_count: number | null;
  candidate_count: number | null;
  selected_count: number | null;
  error_notes: string | null;
  model_synth: string | null;
}

interface BriefingRow {
  id: string;
  headline: string;
  created_at: string;
  market_tone: string | null;
  briefing_type: string;
}

export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get("type") || "morning";
  if (!["morning", "evening"].includes(type)) {
    return NextResponse.json(
      { error: "type must be morning or evening" },
      { status: 400 }
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // Run all queries in parallel
  const [runsResult, lastSuccessBriefingResult, lastAnyBriefingResult] =
    await Promise.all([
      // Last 5 pipeline runs for this type (all statuses)
      supabase
        .from("pipeline_runs")
        .select(
          "id, status, started_at, completed_at, duration_s, " +
          "headline_snap, ingest_count, candidate_count, selected_count, " +
          "error_notes, model_synth"
        )
        .eq("brief_type", type)
        .order("started_at", { ascending: false })
        .limit(5),

      // Last successful (non-stub) briefing row
      supabase
        .from("briefings")
        .select("id, headline, created_at, market_tone, briefing_type")
        .eq("briefing_type", type)
        .neq("headline", "Market Intelligence Unavailable")
        .order("created_at", { ascending: false })
        .limit(1),

      // Last briefing row of any kind (including stubs)
      supabase
        .from("briefings")
        .select("id, headline, created_at, briefing_type")
        .eq("briefing_type", type)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);

  // Cast: pipeline_runs is unregistered in the Supabase Database type,
  // so the SDK returns a generic type. We trust our select columns are correct.
  const recentRuns = (runsResult.data ?? []) as unknown as PipelineRun[];
  const lastSuccessfulBriefing = (lastSuccessBriefingResult.data?.[0] ?? null) as BriefingRow | null;
  const lastAnyBriefing = (lastAnyBriefingResult.data?.[0] ?? null) as BriefingRow | null;

  // Compute freshness of last successful briefing
  const lastSuccessAge = lastSuccessfulBriefing?.created_at
    ? Math.round(
        (Date.now() - new Date(lastSuccessfulBriefing.created_at).getTime()) /
          1000 / 60 / 60 * 10
      ) / 10
    : null;

  const lastRun = recentRuns[0] ?? null;
  const lastSuccessRun = recentRuns.find((r) => r.status === "success") ?? null;
  const lastFailureRun = recentRuns.find((r) => r.status !== "success") ?? null;

  const summary = {
    type,
    now_utc: new Date().toISOString(),
    last_run: lastRun
      ? {
          id: lastRun.id,
          status: lastRun.status,
          started_at: lastRun.started_at,
          completed_at: lastRun.completed_at,
          duration_s: lastRun.duration_s,
          headline_snap: lastRun.headline_snap,
          ingest_count: lastRun.ingest_count,
          candidate_count: lastRun.candidate_count,
          selected_count: lastRun.selected_count,
          error_notes: lastRun.error_notes,
          model_synth: lastRun.model_synth,
        }
      : null,
    last_success_run: lastSuccessRun
      ? {
          id: lastSuccessRun.id,
          started_at: lastSuccessRun.started_at,
          headline_snap: lastSuccessRun.headline_snap,
        }
      : null,
    last_failure_run: lastFailureRun
      ? {
          id: lastFailureRun.id,
          status: lastFailureRun.status,
          started_at: lastFailureRun.started_at,
          error_notes: lastFailureRun.error_notes,
        }
      : null,
    last_successful_briefing: lastSuccessfulBriefing
      ? {
          id: lastSuccessfulBriefing.id,
          headline: lastSuccessfulBriefing.headline,
          created_at: lastSuccessfulBriefing.created_at,
          market_tone: lastSuccessfulBriefing.market_tone,
          age_hours: lastSuccessAge,
        }
      : null,
    last_any_briefing: lastAnyBriefing
      ? {
          id: lastAnyBriefing.id,
          headline: lastAnyBriefing.headline,
          created_at: lastAnyBriefing.created_at,
          is_stub: lastAnyBriefing.headline === "Market Intelligence Unavailable",
        }
      : null,
    recent_runs: recentRuns.map((r) => ({
      id: r.id,
      status: r.status,
      started_at: r.started_at,
      duration_s: r.duration_s,
      error_notes: r.error_notes,
    })),
  };

  const resp = NextResponse.json(summary);
  resp.headers.set("Cache-Control", "no-store, no-cache");
  return resp;
}

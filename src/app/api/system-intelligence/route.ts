import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export async function GET() {
  // Four independent queries, each soft-fail to null

  // 1. Last pipeline run timestamp
  let lastRun: string | null = null;
  try {
    const { data } = await supabase
      .from("pipeline_runs")
      .select("completed_at, status")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    lastRun = data?.completed_at ?? null;
  } catch {
    /* soft-fail */
  }

  // 2. Average brief quality scores (last 7 days)
  let avgQualityScore: number | null = null;
  try {
    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data } = await supabase
      .from("brief_quality_scores")
      .select("soft_flags")
      .gte("created_at", cutoff)
      .not("soft_flags", "is", null);
    if (data && data.length > 0) {
      let total = 0,
        count = 0;
      for (const row of data) {
        const scores = (row.soft_flags as Record<string, unknown>)?.llm_scores as
          | Record<string, unknown>
          | undefined;
        if (scores) {
          const dims = [
            scores.signal_clarity,
            scores.source_diversity,
            scores.actionability,
            scores.novelty,
          ].filter((v): v is number => typeof v === "number");
          if (dims.length > 0) {
            total += dims.reduce((a, b) => a + b, 0) / dims.length;
            count++;
          }
        }
      }
      avgQualityScore = count > 0 ? Math.round((total / count) * 10) / 10 : null;
    }
  } catch {
    /* soft-fail */
  }

  // 3. Top pattern from pattern_library
  let topPattern: { sector: string; horizon: string; win_rate: number } | null = null;
  try {
    const { data } = await supabase
      .from("pattern_library")
      .select("sector, horizon, win_rate")
      .gte("n_observed", 5)
      .order("win_rate", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) topPattern = { sector: data.sector, horizon: data.horizon, win_rate: data.win_rate };
  } catch {
    /* soft-fail */
  }

  // 4. Top source from source_credibility
  let topSource: { source: string; win_rate: number } | null = null;
  try {
    const { data } = await supabase
      .from("source_credibility")
      .select("source, win_rate")
      .order("win_rate", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) topSource = { source: data.source, win_rate: data.win_rate };
  } catch {
    /* soft-fail */
  }

  return NextResponse.json({ lastRun, avgQualityScore, topPattern, topSource });
}

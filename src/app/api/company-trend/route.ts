import { NextRequest, NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { resolveAlias } from "@/lib/data-access/aliasResolver";
import { canonicalize } from "@/lib/company-intel";

// GET /api/company-trend?company=<canonical>&range=7d|30d|90d
//
// Daily tone history for a company, aggregated from company_mentions: per-day
// mean of per-mention sentiment (bullish +1 / neutral 0 / bearish -1), empty days
// excluded. This is the SAME per-mention scoring computeTone (src/lib/tone.ts)
// uses for the headline level, so the chart and the level cannot tell different
// stories. The whole company_mentions table is ~12k rows, so a per-company range
// query is small and the aggregation runs in-memory.
//
// Range options are bounded to real data depth (corpus starts 2026-03-11, ~82
// days): 7d / 30d / 90d only. No 1y/5y, which would render mostly empty.
//
// This route is also the prerequisite for the future Tone-vs-Price divergence
// overlay, so it is built to be reusable, not throwaway.

export const dynamic = "force-dynamic";

const RANGE_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };
const DAY_MS = 86_400_000;

export interface ToneTrendPoint {
  date: string; // YYYY-MM-DD (UTC)
  score: number; // -1..+1, per-day mean of per-mention sentiment
  n: number; // mentions contributing to that day
}

export interface ToneTrendResponse {
  company: string;
  range: string;
  rangeStart: string; // ISO timestamp of the window start
  points: ToneTrendPoint[];
}

function scoreOf(s: string | null): number | null {
  return s === "bullish" ? 1 : s === "bearish" ? -1 : s === "neutral" ? 0 : null;
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const companyParam = (sp.get("company") ?? "").trim();
  const rangeParam = (sp.get("range") ?? "30d").trim();
  const days = RANGE_DAYS[rangeParam];

  if (!companyParam) {
    return NextResponse.json({ error: "missing company" }, { status: 400 });
  }
  if (!days) {
    return NextResponse.json({ error: "invalid range" }, { status: 400 });
  }

  const rangeStartIso = new Date(Date.now() - days * DAY_MS).toISOString();
  const { supabase } = await getSupabaseWithUser();
  const resolved = await resolveAlias(supabase, canonicalize(companyParam));

  // Unresolved name (private / un-indexed): honest empty series, not an error.
  if (!resolved) {
    const empty: ToneTrendResponse = {
      company: companyParam,
      range: rangeParam,
      rangeStart: rangeStartIso,
      points: [],
    };
    return NextResponse.json(empty);
  }

  const ids = [resolved.canonical, ...resolved.siblings].map((r) => r.id);
  const { data, error } = await supabase
    .from("company_mentions")
    .select("created_at, sentiment")
    .in("company_id", ids)
    .gte("created_at", rangeStartIso)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  const sum = new Map<string, number>();
  const cnt = new Map<string, number>();
  for (const row of data ?? []) {
    const sc = scoreOf(row.sentiment);
    if (sc === null || !row.created_at) continue;
    const day = new Date(row.created_at).toISOString().slice(0, 10); // UTC day
    sum.set(day, (sum.get(day) ?? 0) + sc);
    cnt.set(day, (cnt.get(day) ?? 0) + 1);
  }

  const points: ToneTrendPoint[] = [...cnt.keys()]
    .sort()
    .map((day) => ({ date: day, score: (sum.get(day) ?? 0) / (cnt.get(day) ?? 1), n: cnt.get(day) ?? 0 }));

  const body: ToneTrendResponse = {
    company: resolved.canonical.name,
    range: rangeParam,
    rangeStart: rangeStartIso,
    points,
  };
  return NextResponse.json(body, {
    headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=600" },
  });
}

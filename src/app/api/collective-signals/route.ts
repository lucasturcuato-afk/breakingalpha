import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    // 1. Trending watchlist tickers — most added in last 7 days
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: recentWatchlist } = await supabase
      .from("watchlist")
      .select("identifier")
      .gte("added_at", weekAgo);

    const tickerCounts = new Map<string, number>();
    for (const w of recentWatchlist ?? []) {
      const t = w.identifier.toUpperCase();
      tickerCounts.set(t, (tickerCounts.get(t) ?? 0) + 1);
    }

    const trendingTickers = Array.from(tickerCounts.entries())
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([ticker, count]) => ({ ticker, watcherCount: count }));

    // 2. Most active sectors — from user events in last 7 days
    const { data: recentEvents } = await supabase
      .from("user_events")
      .select("payload")
      .gte("created_at", weekAgo)
      .in("event_type", ["thesis_viewed", "thesis_approved", "sector_filter_applied"])
      .limit(500);

    const sectorCounts = new Map<string, number>();
    for (const e of recentEvents ?? []) {
      const payload = typeof e.payload === "string" ? JSON.parse(e.payload) : e.payload;
      const sector = payload?.sector;
      if (sector) sectorCounts.set(sector, (sectorCounts.get(sector) ?? 0) + 1);
    }

    const activeSectors = Array.from(sectorCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([sector, activity]) => ({ sector, activityCount: activity }));

    // 3. Total user count (for context)
    const { count: totalUsers } = await supabase
      .from("user_profiles")
      .select("id", { count: "exact", head: true });

    return NextResponse.json({
      trendingTickers,
      activeSectors,
      totalUsers: totalUsers ?? 0,
    });
  } catch (err) {
    console.error("[collective-signals] error:", err);
    return NextResponse.json({ trendingTickers: [], activeSectors: [], totalUsers: 0 });
  }
}

import { NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { data, error } = await supabase
      .from("pattern_library")
      .select("id, sector, horizon, dominant_signal, win_rate, n_observed, n_confirmed")
      .order("win_rate", { ascending: false })
      .limit(5);

    if (error) {
      console.warn("[theses/patterns] query failed (table may not exist):", error.message);
      return NextResponse.json({ patterns: [] });
    }
    return NextResponse.json({ patterns: data || [] });
  } catch (e) {
    console.error("[theses/patterns] error:", e);
    return NextResponse.json({ patterns: [] });
  }
}

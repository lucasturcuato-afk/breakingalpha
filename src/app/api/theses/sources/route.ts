import { NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { data, error } = await supabase
      .from("source_credibility")
      .select("id, source, win_rate, sample_size")
      .order("win_rate", { ascending: false })
      .limit(5);

    if (error) {
      console.warn("[theses/sources] query failed (table may not exist):", error.message);
      return NextResponse.json({ sources: [] });
    }
    return NextResponse.json({ sources: data || [] });
  } catch (e) {
    console.error("[theses/sources] error:", e);
    return NextResponse.json({ sources: [] });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { getServiceSupabase } from "@/lib/supabase-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { user } = await getSupabaseWithUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json();
    const { briefing_id, section_key, rating } = body;

    if (!section_key || (rating !== 1 && rating !== -1)) {
      return NextResponse.json({ error: "section_key and rating (-1 or 1) required" }, { status: 400 });
    }

    const supabase = getServiceSupabase();

    // Upsert: one rating per user per section per briefing
    const { error } = await supabase
      .from("brief_section_ratings")
      .upsert(
        { user_id: user.id, briefing_id: briefing_id ?? null, section_key, rating, created_at: new Date().toISOString() },
        { onConflict: "user_id,section_key" },
      );

    if (error) {
      // If upsert fails (no unique constraint), just insert
      await supabase.from("brief_section_ratings").insert({
        user_id: user.id, briefing_id: briefing_id ?? null, section_key, rating,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[brief-rating] error:", err);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}

export async function GET() {
  try {
    const { user } = await getSupabaseWithUser();
    if (!user) return NextResponse.json({ ratings: {} });

    const supabase = getServiceSupabase();

    const { data } = await supabase
      .from("brief_section_ratings")
      .select("section_key, rating")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    const ratings: Record<string, number> = {};
    for (const r of data ?? []) {
      if (!(r.section_key in ratings)) ratings[r.section_key] = r.rating;
    }

    return NextResponse.json({ ratings });
  } catch {
    return NextResponse.json({ ratings: {} });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseWithUser } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

function supa() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await getSupabaseWithUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json();
    const { briefing_id, section_key, rating } = body;

    if (!section_key || (rating !== 1 && rating !== -1)) {
      return NextResponse.json({ error: "section_key and rating (-1 or 1) required" }, { status: 400 });
    }

    const supabase = supa();

    // Single upsert — relies on partial unique indexes:
    //   uq_bsr_user_section_no_briefing  (user_id, section_key) WHERE briefing_id IS NULL
    //   uq_bsr_user_section_briefing     (user_id, section_key, briefing_id) WHERE briefing_id IS NOT NULL
    const onConflict = briefing_id
      ? "user_id,section_key,briefing_id"
      : "user_id,section_key";

    const { error } = await supabase
      .from("brief_section_ratings")
      .upsert(
        {
          user_id: user.id,
          briefing_id: briefing_id ?? null,
          section_key,
          rating,
          created_at: new Date().toISOString(),
        },
        { onConflict },
      );

    if (error) {
      console.warn("[brief-rating] upsert error:", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[brief-rating] error:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export async function GET() {
  try {
    const { user } = await getSupabaseWithUser();
    if (!user) return NextResponse.json({ ratings: {}, preferences: {} });

    const supabase = supa();

    const { data } = await supabase
      .from("brief_section_ratings")
      .select("section_key, rating, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200);

    // Latest rating per section (for UI state)
    const ratings: Record<string, number> = {};
    for (const r of data ?? []) {
      if (!(r.section_key in ratings)) ratings[r.section_key] = r.rating;
    }

    // Aggregate preferences: net score per section across all time
    const prefs: Record<string, { up: number; down: number; net: number }> = {};
    for (const r of data ?? []) {
      if (!prefs[r.section_key]) prefs[r.section_key] = { up: 0, down: 0, net: 0 };
      if (r.rating === 1) prefs[r.section_key].up++;
      else prefs[r.section_key].down++;
      prefs[r.section_key].net += r.rating;
    }

    return NextResponse.json({ ratings, preferences: prefs });
  } catch {
    return NextResponse.json({ ratings: {}, preferences: {} });
  }
}

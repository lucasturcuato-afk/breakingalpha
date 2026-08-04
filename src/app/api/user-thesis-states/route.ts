import { NextRequest, NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { data, error } = await supabase
      .from("user_thesis_states")
      .select("id, thesis_id, status, notes, created_at, updated_at")
      .order("updated_at", { ascending: false });

    if (error) {
      console.warn("[user-thesis-states GET] query failed:", error.message);
      return NextResponse.json({ error: "Could not load thesis states." }, { status: 500 });
    }
    return NextResponse.json({ states: data || [] });
  } catch (e) {
    console.error("[user-thesis-states GET] error:", e);
    return NextResponse.json({ states: [] });
  }
}

export async function POST(request: NextRequest) {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const body = await request.json();
    const { thesis_id, status } = body as { thesis_id?: string; status?: string };

    if (!thesis_id) {
      return NextResponse.json({ error: "thesis_id required" }, { status: 400 });
    }

    const validStatuses = ["active", "archived", "watching"];
    const safeStatus = validStatuses.includes(status || "") ? status : "active";

    const { data, error } = await supabase
      .from("user_thesis_states")
      .upsert(
        {
          user_id: user.id,
          thesis_id,
          status: safeStatus,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,thesis_id" }
      )
      .select("id, thesis_id, status, updated_at")
      .single();

    if (error) {
      console.warn("[user-thesis-states POST] upsert failed:", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, state: data });
  } catch (e) {
    console.error("[user-thesis-states POST] error:", e);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}

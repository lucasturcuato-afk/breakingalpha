import { NextRequest, NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const thesisId = request.nextUrl.searchParams.get("thesis_id");
  if (!thesisId) return NextResponse.json({ note: null });

  try {
    // Owner-scoped since sql/0039: RLS restricts to auth.uid() and the
    // explicit filter keeps the query honest if the policy ever widens.
    const { data, error } = await supabase
      .from("thesis_notes")
      .select("content, updated_at")
      .eq("thesis_id", thesisId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      console.warn("[theses/notes GET] query failed:", error.message);
      return NextResponse.json({ note: null });
    }
    return NextResponse.json({ note: data || null });
  } catch (e) {
    console.error("[theses/notes GET] error:", e);
    return NextResponse.json({ note: null });
  }
}

export async function POST(request: NextRequest) {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const body = await request.json();
    const { thesis_id, content } = body as { thesis_id?: string; content?: string };
    if (!thesis_id) {
      return NextResponse.json({ error: "thesis_id required" }, { status: 400 });
    }

    // One note per (user, thesis): sql/0039 moved uniqueness off thesis_id
    // alone, which would have made a note shared by every reader. user_id is
    // written explicitly; the insert policy rejects any other value.
    const { data, error } = await supabase
      .from("thesis_notes")
      .upsert(
        {
          thesis_id,
          user_id: user.id,
          content: content || "",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,thesis_id" }
      )
      .select("content, updated_at")
      .single();

    if (error) {
      console.warn("[theses/notes POST] upsert failed:", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, note: data });
  } catch (e) {
    console.error("[theses/notes POST] error:", e);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const identifier = request.nextUrl.searchParams.get("identifier");
  if (!identifier) return NextResponse.json({ note: null });

  try {
    const { data, error } = await supabase
      .from("watchlist_notes")
      .select("note_text, updated_at")
      .eq("user_id", user.id)
      .eq("identifier", identifier.trim())
      .maybeSingle();

    if (error) {
      console.warn("[watchlist-notes GET] query failed:", error.message);
      return NextResponse.json({ note: null });
    }
    return NextResponse.json({ note: data || null });
  } catch (e) {
    console.error("[watchlist-notes GET] error:", e);
    return NextResponse.json({ note: null });
  }
}

export async function POST(request: NextRequest) {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const body = await request.json();
    const { identifier, note_text } = body as { identifier?: string; note_text?: string };
    if (!identifier) return NextResponse.json({ error: "identifier required" }, { status: 400 });

    const { data, error } = await supabase
      .from("watchlist_notes")
      .upsert(
        {
          user_id: user.id,
          identifier: identifier.trim(),
          note_text: note_text ?? "",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,identifier" },
      )
      .select("note_text, updated_at")
      .single();

    if (error) {
      console.warn("[watchlist-notes POST] upsert failed:", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, note: data });
  } catch (e) {
    console.error("[watchlist-notes POST] error:", e);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const identifier = request.nextUrl.searchParams.get("identifier");
  if (!identifier) return NextResponse.json({ error: "identifier required" }, { status: 400 });

  try {
    const { error } = await supabase
      .from("watchlist_notes")
      .delete()
      .eq("user_id", user.id)
      .eq("identifier", identifier.trim());

    if (error) {
      console.warn("[watchlist-notes DELETE] failed:", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[watchlist-notes DELETE] error:", e);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}

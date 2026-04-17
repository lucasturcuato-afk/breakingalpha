import { NextRequest, NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { updates } = body as { updates?: { id: string; sort_order: number }[] };

    if (!Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json({ error: "updates array required" }, { status: 400 });
    }

    // Validate all IDs belong to this user
    const ids = updates.map((u) => u.id);
    const { data: owned, error: validateError } = await supabase
      .from("watchlist")
      .select("id")
      .eq("user_id", user.id)
      .in("id", ids);

    if (validateError) {
      return NextResponse.json({ error: validateError.message }, { status: 500 });
    }

    if (!owned || owned.length !== ids.length) {
      return NextResponse.json({ error: "Unauthorized: one or more IDs do not belong to you" }, { status: 403 });
    }

    // Batch upsert sort_order
    const { error: upsertError } = await supabase
      .from("watchlist")
      .upsert(
        updates.map((u) => ({ id: u.id, sort_order: u.sort_order, user_id: user.id })),
        { onConflict: "id" }
      );

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, updated: updates.length });
  } catch (e) {
    console.error("[watchlist-reorder PATCH] error:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

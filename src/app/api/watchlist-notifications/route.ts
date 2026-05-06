import { NextRequest, NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

// Freshness gate: hide notifications older than this many days.
// 14 days balances "users see notifications they may have missed last week"
// with "stale alerts do not pile up indefinitely." Strict gate -- applies
// regardless of read state. Tune here for future adjustment.
const NOTIFICATION_MAX_AGE_DAYS = 14;

export async function GET() {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const cutoffIso = new Date(
      Date.now() - NOTIFICATION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { data, error } = await supabase
      .from("watchlist_notifications")
      .select("id, identifier, type, title, body, read, created_at")
      .eq("user_id", user.id)
      .gte("created_at", cutoffIso)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.warn("[watchlist-notifications GET] query failed:", error.message);
      return NextResponse.json({ notifications: [] });
    }
    return NextResponse.json({ notifications: data ?? [] });
  } catch (e) {
    console.error("[watchlist-notifications GET] error:", e);
    return NextResponse.json({ notifications: [] });
  }
}

export async function PATCH(request: NextRequest) {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const body = await request.json();
    const { ids } = body as { ids?: string[] };
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "ids array required" }, { status: 400 });
    }

    const { error } = await supabase
      .from("watchlist_notifications")
      .update({ read: true })
      .in("id", ids)
      .eq("user_id", user.id);

    if (error) {
      console.warn("[watchlist-notifications PATCH] update failed:", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[watchlist-notifications PATCH] error:", e);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  try {
    const { error } = await supabase
      .from("watchlist_notifications")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) {
      console.warn("[watchlist-notifications DELETE] failed:", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[watchlist-notifications DELETE] error:", e);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}

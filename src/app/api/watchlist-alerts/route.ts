import { NextRequest, NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const VALID_ALERT_TYPES = ["percent_change", "price_above", "price_below"] as const;
type AlertType = (typeof VALID_ALERT_TYPES)[number];

export async function GET(request: NextRequest) {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const identifier = request.nextUrl.searchParams.get("identifier");
  if (!identifier) return NextResponse.json({ error: "identifier required" }, { status: 400 });

  try {
    const { data, error } = await supabase
      .from("watchlist_price_alerts")
      .select("id, identifier, alert_type, threshold, direction, enabled, last_triggered, created_at")
      .eq("user_id", user.id)
      .eq("identifier", identifier.trim())
      .order("created_at", { ascending: true });

    if (error) {
      console.warn("[watchlist-alerts GET] query failed:", error.message);
      return NextResponse.json({ alerts: [] });
    }
    return NextResponse.json({ alerts: data ?? [] });
  } catch (e) {
    console.error("[watchlist-alerts GET] error:", e);
    return NextResponse.json({ alerts: [] });
  }
}

export async function POST(request: NextRequest) {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const body = await request.json();
    const { identifier, alert_type, threshold, direction } = body as {
      identifier?: string;
      alert_type?: string;
      threshold?: unknown;
      direction?: string;
    };

    if (!identifier) return NextResponse.json({ error: "identifier required" }, { status: 400 });
    if (!alert_type || !VALID_ALERT_TYPES.includes(alert_type as AlertType)) {
      return NextResponse.json(
        { error: "alert_type must be one of: percent_change, price_above, price_below" },
        { status: 400 },
      );
    }
    const thresholdNum = Number(threshold);
    if (isNaN(thresholdNum) || thresholdNum <= 0) {
      return NextResponse.json({ error: "threshold must be a positive number" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("watchlist_price_alerts")
      .insert([{
        user_id: user.id,
        identifier: identifier.trim(),
        alert_type,
        threshold: thresholdNum,
        direction: direction ?? null,
        enabled: true,
      }])
      .select("id, identifier, alert_type, threshold, direction, enabled, last_triggered, created_at")
      .single();

    if (error) {
      console.warn("[watchlist-alerts POST] insert failed:", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, alert: data });
  } catch (e) {
    console.error("[watchlist-alerts POST] error:", e);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const body = await request.json();
    const { id, enabled } = body as { id?: string; enabled?: boolean };
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    if (typeof enabled !== "boolean") {
      return NextResponse.json({ error: "enabled (boolean) required" }, { status: 400 });
    }

    const { error } = await supabase
      .from("watchlist_price_alerts")
      .update({ enabled })
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) {
      console.warn("[watchlist-alerts PATCH] update failed:", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[watchlist-alerts PATCH] error:", e);
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
      .from("watchlist_price_alerts")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) {
      console.warn("[watchlist-alerts DELETE] failed:", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[watchlist-alerts DELETE] error:", e);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}

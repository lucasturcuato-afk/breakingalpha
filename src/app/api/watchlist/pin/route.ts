import { NextRequest, NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

interface PinRequestBody {
  ticker?: unknown;
  position?: unknown;
}

export async function POST(request: NextRequest) {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: PinRequestBody;
  try {
    body = (await request.json()) as PinRequestBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const tickerRaw = body.ticker;
  const positionRaw = body.position;

  if (typeof tickerRaw !== "string" || tickerRaw.trim().length === 0) {
    return NextResponse.json({ error: "ticker_required" }, { status: 400 });
  }
  const ticker = tickerRaw.trim().toUpperCase();

  let position: number | null;
  if (positionRaw === null) {
    position = null;
  } else if (
    typeof positionRaw === "number" &&
    Number.isInteger(positionRaw) &&
    positionRaw >= 1 &&
    positionRaw <= 5
  ) {
    position = positionRaw;
  } else {
    return NextResponse.json({ error: "invalid_position" }, { status: 400 });
  }

  if (position !== null) {
    const { error: clearError } = await supabase
      .from("watchlist")
      .update({ pinned_position: null })
      .eq("user_id", user.id)
      .eq("type", "ticker")
      .eq("pinned_position", position);
    if (clearError) {
      console.error("[watchlist/pin] clear error:", clearError.message);
      return NextResponse.json({ error: "db_error" }, { status: 500 });
    }
  }

  const { data: targetRow, error: findError } = await supabase
    .from("watchlist")
    .select("id")
    .eq("user_id", user.id)
    .eq("type", "ticker")
    .eq("identifier", ticker)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (findError) {
    console.error("[watchlist/pin] find error:", findError.message);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
  if (!targetRow) {
    return NextResponse.json({ error: "ticker_not_in_watchlist" }, { status: 404 });
  }

  const { error: setError } = await supabase
    .from("watchlist")
    .update({ pinned_position: position })
    .eq("id", targetRow.id);

  if (setError) {
    console.error("[watchlist/pin] set error:", setError.message);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

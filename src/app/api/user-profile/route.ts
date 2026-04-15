import { NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const DEFAULT_PROFILE = {
  onboarding_completed: false,
  full_name: null,
  role: null,
  firm: null,
  sectors: [],
  risk_appetite: "balanced",
  watchlist_tickers: [],
};

export async function GET() {
  try {
    const { supabase, user } = await getSupabaseWithUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (error && error.code !== "PGRST116") {
      // PGRST116 = no rows found — that's fine, return defaults
      console.error("user-profile GET error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data ?? { id: user.id, ...DEFAULT_PROFILE });
  } catch (err) {
    console.error("user-profile GET unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, user } = await getSupabaseWithUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    // Whitelist allowed fields
    const allowedFields = [
      "full_name",
      "role",
      "firm",
      "sectors",
      "risk_appetite",
      "watchlist_tickers",
      "onboarding_completed",
    ] as const;

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const field of allowedFields) {
      if (field in body) {
        updates[field] = body[field];
      }
    }

    const { data, error } = await supabase
      .from("user_profiles")
      .upsert(
        { id: user.id, ...updates },
        { onConflict: "id" },
      )
      .select()
      .single();

    if (error) {
      console.error("user-profile PATCH error:", error.message);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, profile: data });
  } catch (err) {
    console.error("user-profile PATCH unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

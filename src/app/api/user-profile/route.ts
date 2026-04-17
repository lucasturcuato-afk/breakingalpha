import { NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const DEFAULT_PROFILE = {
  onboarding_completed: false,
  first_name: null,
  role: null,
  firm_or_school: null,
  sectors: [],
  risk_appetite: "balanced",
  strategy_type: null,
  investment_horizon: null,
  workflow_style: null,
  watchlist_tickers: [],
};

// Columns that may be missing in older Supabase schemas. When the upsert fails
// because one of these isn't present, we retry without them and log the DDL.
const OPTIONAL_COLUMNS = [
  "strategy_type",
  "investment_horizon",
  "workflow_style",
  "inferred_sector_weights",
  "risk_appetite",
];

const MISSING_COLUMN_DDL = `-- Add missing profile columns:
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS strategy_type TEXT
    CHECK (strategy_type IN ('pe', 'equity', 'vc', 'macro', 'credit'));
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS investment_horizon TEXT
    CHECK (investment_horizon IN ('short', 'medium', 'long'));
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS workflow_style TEXT
    CHECK (workflow_style IN ('deep_dive', 'screening', 'monitoring'));
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS risk_appetite TEXT
    CHECK (risk_appetite IN ('aggressive', 'balanced', 'defensive'))
    DEFAULT 'balanced';`;

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

    const profile = data ?? { id: user.id, ...DEFAULT_PROFILE };

    // Fallback: if first_name is null, try auth user metadata
    if (!profile.first_name) {
      profile.first_name = user.user_metadata?.full_name ?? user.email ?? null;
    }

    return NextResponse.json(profile);
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
      "first_name",
      "role",
      "firm_or_school",
      "sectors",
      "risk_appetite",
      "strategy_type",
      "investment_horizon",
      "workflow_style",
      "watchlist_tickers",
      "onboarding_completed",
      "inferred_sector_weights",
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
      // Retry without the optional columns if the schema is pre-migration.
      const mentionsOptional = OPTIONAL_COLUMNS.some((c) =>
        error.message.includes(c),
      );
      if (mentionsOptional) {
        console.warn(
          `[user-profile PATCH] hit missing column(s): ${error.message}\n` +
            `[user-profile PATCH] Apply the migration to unlock full personalization:\n${MISSING_COLUMN_DDL}`,
        );
        const retry = { ...updates };
        for (const col of OPTIONAL_COLUMNS) delete retry[col];
        const { data: retryData, error: retryErr } = await supabase
          .from("user_profiles")
          .upsert(
            { id: user.id, ...retry },
            { onConflict: "id" },
          )
          .select()
          .single();
        if (!retryErr) {
          return NextResponse.json({ success: true, profile: retryData });
        }
        console.error("user-profile PATCH retry error:", retryErr.message);
        return NextResponse.json({ success: false, error: retryErr.message }, { status: 500 });
      }
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

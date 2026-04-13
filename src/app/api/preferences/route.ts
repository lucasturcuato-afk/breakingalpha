import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(request: NextRequest) {
  const token = request.headers
    .get("authorization")
    ?.replace("Bearer ", "");
  if (!token)
    return NextResponse.json(
      { error: "Sign in to manage preferences" },
      { status: 401 }
    );

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user)
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });

  const { data, error } = await supabase
    .from("user_preferences")
    .select("*")
    .eq("user_id", user.id)
    .single();
  if (error && error.code !== "PGRST116")
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ preferences: data || null });
}

export async function POST(request: NextRequest) {
  const token = request.headers
    .get("authorization")
    ?.replace("Bearer ", "");
  if (!token)
    return NextResponse.json(
      { error: "Sign in to manage preferences" },
      { status: 401 }
    );

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user)
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { sectors, modules, prioritize_watchlist, vertical_interests, activity_interests } = body as {
    sectors?: unknown;
    modules?: unknown;
    prioritize_watchlist?: unknown;
    vertical_interests?: unknown;
    activity_interests?: unknown;
  };
  if (sectors !== undefined && !Array.isArray(sectors))
    return NextResponse.json({ error: "sectors must be an array" }, { status: 400 });
  if (modules !== undefined && !Array.isArray(modules))
    return NextResponse.json({ error: "modules must be an array" }, { status: 400 });
  if (vertical_interests !== undefined && !Array.isArray(vertical_interests))
    return NextResponse.json({ error: "vertical_interests must be an array" }, { status: 400 });
  if (activity_interests !== undefined && !Array.isArray(activity_interests))
    return NextResponse.json({ error: "activity_interests must be an array" }, { status: 400 });

  const upsertPayload: Record<string, unknown> = {
    user_id: user.id,
    modules: modules ?? [],
    prioritize_watchlist: prioritize_watchlist ?? false,
    updated_at: new Date().toISOString(),
  };
  if (sectors !== undefined) upsertPayload.sectors = sectors;
  if (vertical_interests !== undefined) upsertPayload.vertical_interests = vertical_interests;
  if (activity_interests !== undefined) upsertPayload.activity_interests = activity_interests;

  const { data, error } = await supabase
    .from("user_preferences")
    .upsert(upsertPayload, { onConflict: "user_id" })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ preferences: data });
}

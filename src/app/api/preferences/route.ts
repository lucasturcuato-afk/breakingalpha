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

  const { sectors, modules, prioritize_watchlist } = await request.json();
  const { data, error } = await supabase
    .from("user_preferences")
    .upsert(
      {
        user_id: user.id,
        sectors: sectors ?? [],
        modules: modules ?? [],
        prioritize_watchlist: prioritize_watchlist ?? false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    )
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ preferences: data });
}

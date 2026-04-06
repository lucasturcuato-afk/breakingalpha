import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

async function getSupabaseWithUser() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        },
      },
    },
  );

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    console.error("Watchlist auth error:", error?.message ?? "no user");
    return { supabase, user: null };
  }
  return { supabase, user };
}

export async function GET() {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("watchlist")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Watchlist GET error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ entries: data || [] });
}

export async function POST(request: NextRequest) {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { identifier, type } = await request.json();
  if (!identifier || !type)
    return NextResponse.json(
      { error: "identifier and type required" },
      { status: 400 },
    );

  const normalizedIdentifier = identifier.trim().toUpperCase();

  const { data: existing } = await supabase
    .from("watchlist")
    .select("id")
    .eq("identifier", normalizedIdentifier)
    .eq("type", type)
    .eq("user_id", user.id)
    .single();
  if (existing)
    return NextResponse.json(
      { error: `${normalizedIdentifier} is already in your watchlist.` },
      { status: 400 },
    );

  // Validate tickers and companies via Finnhub (skip for sectors)
  if (type === "ticker" && process.env.FINNHUB_API_KEY) {
    const r = await fetch(
      `https://finnhub.io/api/v1/search?q=${encodeURIComponent(normalizedIdentifier)}&token=${process.env.FINNHUB_API_KEY}`,
    );
    const d = await r.json();
    if (!(d.result || []).some((x: { symbol: string }) => x.symbol === normalizedIdentifier))
      return NextResponse.json(
        { error: "Ticker not found. Please enter a valid symbol." },
        { status: 400 },
      );
  } else if (type === "company" && process.env.FINNHUB_API_KEY) {
    const r = await fetch(
      `https://finnhub.io/api/v1/search?q=${encodeURIComponent(normalizedIdentifier)}&token=${process.env.FINNHUB_API_KEY}`,
    );
    const d = await r.json();
    if (!(d.result || []).length)
      return NextResponse.json({ error: "Company not found." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("watchlist")
    .insert([
      {
        identifier: normalizedIdentifier,
        type,
        user_id: user.id,
      },
    ])
    .select()
    .single();

  if (error) {
    console.error("Watchlist INSERT error:", error.message, error.details, error.hint);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ entry: data });
}

export async function DELETE(request: NextRequest) {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await request.json();
  if (!id)
    return NextResponse.json({ error: "id required" }, { status: 400 });

  const { data, error } = await supabase
    .from("watchlist")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) {
    console.error("Watchlist DELETE error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ entry: data });
}

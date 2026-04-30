import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

function toTitleCase(str: string): string {
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

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

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { identifier, type, display_name: clientDisplayName } = body as {
    identifier?: string;
    type?: string;
    display_name?: string;
  };
  if (!identifier || !type)
    return NextResponse.json(
      { error: "identifier and type required" },
      { status: 400 },
    );

  // Only tickers go uppercase; companies and sectors preserve original casing
  const normalizedIdentifier =
    type === "ticker"
      ? identifier.trim().toUpperCase()
      : identifier.trim();

  // Case-insensitive duplicate check for non-tickers (companies/sectors)
  let existingId: string | null = null;
  if (type === "ticker") {
    const { data } = await supabase
      .from("watchlist").select("id")
      .eq("identifier", normalizedIdentifier)
      .eq("type", type).eq("user_id", user.id)
      .maybeSingle();
    existingId = data?.id ?? null;
  } else {
    const { data } = await supabase
      .from("watchlist").select("id")
      .ilike("identifier", normalizedIdentifier)
      .eq("type", type).eq("user_id", user.id)
      .maybeSingle();
    existingId = data?.id ?? null;
  }
  if (existingId) return NextResponse.json(
    { error: `${normalizedIdentifier} is already in your watchlist.` },
    { status: 400 },
  );

  // Resolve display_name:
  // 1. If client already provided display_name (from autocomplete), use it directly.
  // 2. Otherwise, fall back to Finnhub lookup for tickers.
  let displayName: string | null = clientDisplayName?.trim() || null;

  if (!displayName && type === "ticker" && process.env.FINNHUB_API_KEY) {
    const r = await fetch(
      `https://finnhub.io/api/v1/search?q=${encodeURIComponent(normalizedIdentifier)}&token=${process.env.FINNHUB_API_KEY}`,
    );
    const d = await r.json();
    const match = (d.result || []).find(
      (x: { symbol: string }) => x.symbol === normalizedIdentifier,
    );
    if (!match) return NextResponse.json(
      { error: "Ticker not found. Please enter a valid symbol." },
      { status: 400 },
    );
    displayName = match.description ? toTitleCase(match.description) : null;
  }

  const { data, error } = await supabase
    .from("watchlist")
    .insert([{
      identifier: normalizedIdentifier,
      type,
      user_id: user.id,
      ...(displayName ? { display_name: displayName } : {}),
    }])
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

  let delBody: Record<string, unknown>;
  try {
    delBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { id } = delBody as { id?: string };
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

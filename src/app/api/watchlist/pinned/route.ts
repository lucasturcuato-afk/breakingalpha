import { NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

interface PinnedRow {
  identifier: string;
  display_name: string | null;
  pinned_position: number;
}

interface PinnedItem {
  ticker: string;
  name: string;
  price: number;
  change_pct: number;
}

interface FinnhubQuote {
  c?: number;
  dp?: number;
}

async function fetchQuote(ticker: string, apiKey: string): Promise<{ price: number; change_pct: number }> {
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`;
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) return { price: 0, change_pct: 0 };
    const data = (await res.json()) as FinnhubQuote;
    return {
      price: typeof data.c === "number" ? data.c : 0,
      change_pct: typeof data.dp === "number" ? data.dp : 0,
    };
  } catch {
    return { price: 0, change_pct: 0 };
  }
}

export async function GET() {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) {
    return NextResponse.json({ items: [] });
  }

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    console.error("[watchlist/pinned] FINNHUB_API_KEY not set");
    return NextResponse.json({ items: [], error: "config" });
  }

  const { data, error } = await supabase
    .from("watchlist")
    .select("identifier, display_name, pinned_position")
    .eq("user_id", user.id)
    .eq("type", "ticker")
    .not("pinned_position", "is", null)
    .order("pinned_position", { ascending: true })
    .limit(5);

  if (error) {
    console.error("[watchlist/pinned] query error:", error.message);
    return NextResponse.json({ items: [] });
  }

  const rows = (data ?? []) as PinnedRow[];

  const items: PinnedItem[] = await Promise.all(
    rows.map(async (row) => {
      const ticker = row.identifier;
      const { price, change_pct } = await fetchQuote(ticker, apiKey);
      return {
        ticker,
        name: row.display_name ?? ticker,
        price,
        change_pct,
      };
    }),
  );

  return NextResponse.json({ items });
}

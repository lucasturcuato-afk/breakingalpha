import { NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // 1. Get user's watchlist identifiers
  const { data: watchlist } = await supabase
    .from("watchlist")
    .select("identifier")
    .eq("user_id", user.id);

  const identifiers = (watchlist ?? [])
    .map((w) => w.identifier)
    .filter(Boolean);

  if (identifiers.length === 0) {
    return NextResponse.json({ articles: [], identifiers: [] });
  }

  // 2. Fetch recent articles across all watchlist identifiers (last 48h)
  const cutoff = new Date(Date.now() - 48 * 3600000).toISOString();

  const { data: articles, error } = await supabase
    .from("watchlist_articles")
    .select(
      "article_id, identifier, title, url, source, source_type, summary, published_at, relevance_score",
    )
    .in("identifier", identifiers.slice(0, 50))
    .gte("fetched_at", cutoff)
    .order("relevance_score", { ascending: false })
    .limit(20);

  if (error) {
    console.error("[watchlist-feed] error:", error.message);
    return NextResponse.json({ articles: [], identifiers });
  }

  return NextResponse.json({
    articles: articles ?? [],
    identifiers,
  });
}

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

  // 2. Fetch recent articles across all watchlist identifiers.
  //
  // Recency means PUBLISHED recently, over a 7-day window. The old filter was
  // fetched_at >= 48h, which measured when the SYNC JOB last cached rows, not
  // how old the news is: one missed pipeline window emptied the whole tile
  // while 150+ real articles from the past week sat in the table. Each row
  // renders its real age, so a 3-day-old story is honest; a false "no recent
  // articles" is not.
  const cutoff = new Date(Date.now() - 7 * 24 * 3600000).toISOString();

  const { data: articles, error } = await supabase
    .from("watchlist_articles")
    .select(
      "article_id, identifier, title, url, source, source_type, summary, published_at, relevance_score",
    )
    .in("identifier", identifiers.slice(0, 50))
    .gte("published_at", cutoff)
    .order("relevance_score", { ascending: false })
    // 40 rows so the dashboard wire spans more of the watchlist instead of
    // whichever single name dominates the relevance top-20 that day.
    .limit(40);

  if (error) {
    console.error("[watchlist-feed] error:", error.message);
    // A failed query is an error, not an empty feed. Returning 200 with []
    // here is what made a DB failure render as "no recent articles".
    return NextResponse.json(
      { error: "Could not load watchlist articles.", identifiers },
      { status: 500 },
    );
  }

  return NextResponse.json({
    articles: articles ?? [],
    identifiers,
  });
}

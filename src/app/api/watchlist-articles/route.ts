import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export async function GET(request: NextRequest) {
  const identifier = request.nextUrl.searchParams.get("identifier");
  if (!identifier || identifier.trim().length === 0) {
    return NextResponse.json({ error: "identifier required" }, { status: 400 });
  }

  const { data, error } = await getSupabase()
    .from("watchlist_articles")
    .select(
      "article_id, identifier, title, url, source, source_type, summary, published_at, relevance_score, fetched_at"
    )
    .eq("identifier", identifier.trim())
    .order("published_at", { ascending: false })
    .limit(30);

  if (error) {
    // 200-with-[] here made a failed read look like a cold cache, which the
    // radar watchlist then treated as a cache miss. Same class as the Watch bug.
    console.error("watchlist-articles GET error:", error.message);
    return NextResponse.json(
      { error: "Could not load articles for this identifier." },
      { status: 500 },
    );
  }

  const articles = data ?? [];
  return NextResponse.json({ articles, count: articles.length });
}

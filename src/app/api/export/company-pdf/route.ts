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
  if (!identifier) {
    return NextResponse.json({ error: "identifier required" }, { status: 400 });
  }

  const supabase = getSupabase();

  try {
    const [entryRes, articlesRes, briefRes] = await Promise.all([
      supabase.from("watchlist").select("identifier, type, display_name").ilike("identifier", identifier).maybeSingle(),
      supabase.from("watchlist_articles").select("article_id, title, url, source, published_at, relevance_score, summary").eq("identifier", identifier).order("relevance_score", { ascending: false }).limit(15),
      supabase.from("watchlist_briefs").select("brief_text, generated_at").eq("identifier", identifier).maybeSingle(),
    ]);

    // Note: notes require auth — fetch without user context returns null
    return NextResponse.json({
      entry: entryRes.data ?? null,
      articles: articlesRes.data ?? [],
      brief: briefRes.data ?? null,
    });
  } catch (e) {
    console.error("[company-pdf GET] error:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

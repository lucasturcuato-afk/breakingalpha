import { NextRequest, NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function getAnonSupabase() {
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

  const { supabase: authSupabase, user } = await getSupabaseWithUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const anonSupabase = getAnonSupabase();

  try {
    const [entryRes, articlesRes, briefRes] = await Promise.all([
      // Scoped to authenticated user only
      authSupabase.from("watchlist").select("identifier, type, display_name").eq("user_id", user.id).ilike("identifier", identifier).maybeSingle(),
      // Articles and briefs are shared per-identifier (public by design)
      anonSupabase.from("watchlist_articles").select("article_id, title, url, source, published_at, relevance_score, summary").eq("identifier", identifier).order("relevance_score", { ascending: false }).limit(15),
      anonSupabase.from("watchlist_briefs").select("brief_text, generated_at").eq("identifier", identifier).maybeSingle(),
    ]);

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

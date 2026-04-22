import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseWithUser } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { supabase: authClient, user } = await getSupabaseWithUser();
    if (!user) return NextResponse.json({ alerts: [] });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    // Get user's watchlist tickers
    const { data: watchlist } = await authClient
      .from("watchlist")
      .select("identifier")
      .eq("user_id", user.id);

    const tickers = (watchlist ?? []).map(w => w.identifier.toLowerCase());
    if (tickers.length === 0) return NextResponse.json({ alerts: [] });

    // Find competitors of watchlist companies
    const { data: competitors } = await supabase
      .from("competitor_map")
      .select("ticker, competitor_ticker, co_mention_count")
      .in("ticker", tickers)
      .order("co_mention_count", { ascending: false })
      .limit(20);

    if (!competitors || competitors.length === 0) return NextResponse.json({ alerts: [] });

    // Find recent articles mentioning these competitors (last 48h)
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data: articles } = await supabase
      .from("articles")
      .select("id, title, source, companies, published_at")
      .gte("ingested_at", cutoff)
      .order("ingested_at", { ascending: false })
      .limit(200);

    // Match articles to competitors
    const alerts: { competitor: string; watchlistTicker: string; article: { title: string; source: string; published_at: string }; coMentionStrength: number }[] = [];

    for (const article of articles ?? []) {
      let articleCompanies = article.companies;
      if (typeof articleCompanies === "string") {
        try { articleCompanies = JSON.parse(articleCompanies); } catch { continue; }
      }
      if (!Array.isArray(articleCompanies)) continue;

      const articleCompanyLower = articleCompanies.map((c: string) => c.toLowerCase());

      for (const comp of competitors) {
        if (articleCompanyLower.some((ac: string) => ac.includes(comp.competitor_ticker) || comp.competitor_ticker.includes(ac))) {
          alerts.push({
            competitor: comp.competitor_ticker,
            watchlistTicker: comp.ticker,
            article: { title: article.title, source: article.source, published_at: article.published_at },
            coMentionStrength: comp.co_mention_count,
          });
        }
      }
    }

    // Deduplicate and limit
    const seen = new Set<string>();
    const uniqueAlerts = alerts.filter(a => {
      const key = `${a.competitor}:${a.article.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 10);

    return NextResponse.json({ alerts: uniqueAlerts });
  } catch (err) {
    console.error("[competitor-alerts] error:", err);
    return NextResponse.json({ alerts: [] });
  }
}

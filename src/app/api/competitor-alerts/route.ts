import { NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { unwrapRows } from "@/lib/supabase-query";
import { getServiceSupabase } from "@/lib/supabase-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { supabase: authClient, user } = await getSupabaseWithUser();
    if (!user) return NextResponse.json({ alerts: [] });

    const supabase = getServiceSupabase();

    // Get user's watchlist tickers
    const watchlist = unwrapRows<{ identifier: string }>(
      await authClient.from("watchlist").select("identifier").eq("user_id", user.id),
      "competitor-alerts watchlist",
    );

    const tickers = watchlist.map((w) => w.identifier.toLowerCase());
    if (tickers.length === 0) return NextResponse.json({ alerts: [] });

    // Find competitors of watchlist companies
    const competitors = unwrapRows<{ ticker: string; competitor_ticker: string; co_mention_count: number }>(
      await supabase
        .from("competitor_map")
        .select("ticker, competitor_ticker, co_mention_count")
        .in("ticker", tickers)
        .order("co_mention_count", { ascending: false })
        .limit(20),
      "competitor-alerts competitor_map",
    );

    if (competitors.length === 0) return NextResponse.json({ alerts: [] });

    // Recent articles mentioning these competitors. Windowed on published_at,
    // not ingested_at: the ingest timestamp measures when the pipeline last
    // ran, so a missed run emptied this widget while real articles existed.
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const articles = unwrapRows<{ id: string; title: string; source: string; companies: unknown; published_at: string }>(
      await supabase
        .from("articles")
        .select("id, title, source, companies, published_at")
        .gte("published_at", cutoff)
        .order("published_at", { ascending: false })
        .limit(200),
      "competitor-alerts articles",
    );

    // Match articles to competitors
    const alerts: { competitor: string; watchlistTicker: string; article: { title: string; source: string; published_at: string }; coMentionStrength: number }[] = [];

    for (const article of articles) {
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

    // Deduplicate exact repeats first.
    const seen = new Set<string>();
    const uniqueAlerts = alerts.filter(a => {
      const key = `${a.competitor}:${a.article.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Rank by recency (strength as tiebreak), then apply diversity caps so a
    // single prolific competitor or watchlist name cannot monopolize the tile
    // the way raw ingest order did. If the result is thin after capping, that
    // is honest sparsity; the widget shows its clean empty/short state.
    uniqueAlerts.sort((a, b) => {
      const ta = new Date(a.article.published_at ?? 0).getTime();
      const tb = new Date(b.article.published_at ?? 0).getTime();
      if (tb !== ta) return tb - ta;
      return b.coMentionStrength - a.coMentionStrength;
    });
    const MAX_PER_COMPETITOR = 2;
    const MAX_PER_WATCHLIST_NAME = 3;
    const perCompetitor = new Map<string, number>();
    const perWatch = new Map<string, number>();
    const capped: typeof uniqueAlerts = [];
    for (const a of uniqueAlerts) {
      const c = perCompetitor.get(a.competitor) ?? 0;
      const w = perWatch.get(a.watchlistTicker) ?? 0;
      if (c >= MAX_PER_COMPETITOR || w >= MAX_PER_WATCHLIST_NAME) continue;
      perCompetitor.set(a.competitor, c + 1);
      perWatch.set(a.watchlistTicker, w + 1);
      capped.push(a);
      if (capped.length >= 10) break;
    }

    return NextResponse.json({ alerts: capped });
  } catch (err) {
    // A failed read is an error, not "no competitor activity". Returning an
    // empty list here made a broken query indistinguishable from a quiet market.
    console.error("[competitor-alerts] error:", err);
    return NextResponse.json({ error: "Could not load competitor alerts." }, { status: 500 });
  }
}

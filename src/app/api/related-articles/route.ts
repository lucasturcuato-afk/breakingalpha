import { NextRequest, NextResponse } from "next/server";

import { getSupabaseWithUser } from "@/lib/supabase-server";
import { parseSourceTicker } from "@/lib/top-stories";

// Nearest-neighbor articles for the dashboard hero's "In this thread" row.
// Calls the related_articles RPC (sql/0011_related_articles_rpc.sql), which
// reuses the article's STORED embedding from content_embeddings — no
// re-embedding, zero embedding-API cost. Auth-gated like the other dashboard
// data routes. Degrades to an empty list (200) when the RPC is not yet
// provisioned or errors, so the hero simply hides the row.

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface MatchRow {
  article_id: string;
  similarity: number;
}

export async function GET(request: NextRequest) {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const id = (request.nextUrl.searchParams.get("id") ?? "").trim();
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const { data: matches, error } = await supabase.rpc("related_articles", {
    p_article_id: id,
    p_count: 3,
  });
  if (error || !matches || matches.length === 0) {
    // Missing function (not yet applied) or no neighbors: empty row, no error
    // surfaced to the hero.
    if (error) console.error("[related-articles] rpc error:", error.message);
    return NextResponse.json({ related: [] });
  }

  const rows = matches as MatchRow[];
  const ids = rows.map((m) => m.article_id);
  const { data: articles, error: artError } = await supabase
    .from("articles")
    .select("id, title, url, source, summary, published_at")
    .in("id", ids);
  if (artError || !articles) {
    if (artError) console.error("[related-articles] articles fetch error:", artError.message);
    return NextResponse.json({ related: [] });
  }

  const byId = new Map(articles.map((a) => [a.id, a]));
  const related = rows
    .map((m) => {
      const a = byId.get(m.article_id);
      if (!a || !a.title) return null;
      return {
        id: a.id,
        title: a.title,
        url: a.url,
        source: a.source,
        summary: a.summary,
        published_at: a.published_at,
        ticker: parseSourceTicker(a.source),
        similarity: m.similarity,
      };
    })
    .filter(Boolean);

  return NextResponse.json(
    { related },
    { headers: { "Cache-Control": "private, max-age=300" } },
  );
}

import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getSupabaseWithUser } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) {
    return new NextResponse("Not authenticated", { status: 401 });
  }

  try {
    const { data: entries } = await supabase
      .from("watchlist")
      .select("identifier, type, display_name, sort_order, created_at")
      .eq("user_id", user.id)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });

    const date = new Date().toISOString().split("T")[0];
    const wb = XLSX.utils.book_new();

    if (!entries || entries.length === 0) {
      const ws = XLSX.utils.aoa_to_sheet([
        ["Identifier", "Type", "Display Name", "Article Title", "Source", "Published Date", "URL", "Relevance Score"],
      ]);
      XLSX.utils.book_append_sheet(wb, ws, "Articles");
      const summaryWs = XLSX.utils.aoa_to_sheet([
        ["Identifier", "Type", "Display Name", "Article Count", "Last Fetched"],
      ]);
      XLSX.utils.book_append_sheet(wb, summaryWs, "Summary");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      console.log("[watchlist-xlsx] 0 rows (empty watchlist)");
      return new NextResponse(buf, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="signalera-watchlist-${date}.xlsx"`,
        },
      });
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const identifiers = entries.map((e) => e.identifier);

    const { data: articles } = await supabase
      .from("watchlist_articles")
      .select("identifier, title, source, published_at, relevance_score, url, fetched_at")
      .in("identifier", identifiers)
      .gte("published_at", thirtyDaysAgo)
      .order("identifier", { ascending: true })
      .order("published_at", { ascending: false })
      .limit(2000);

    const entryMap: Record<string, { type: string; display_name: string | null }> = {};
    for (const e of entries) {
      entryMap[e.identifier] = { type: e.type, display_name: e.display_name };
    }

    // Articles sheet
    const articleRows: (string | number | null)[][] = [
      ["Identifier", "Type", "Display Name", "Article Title", "Source", "Published Date", "URL", "Relevance Score"],
    ];
    for (const a of articles ?? []) {
      const entry = entryMap[a.identifier];
      articleRows.push([
        a.identifier,
        entry?.type ?? "",
        entry?.display_name ?? "",
        a.title ?? "",
        a.source ?? "",
        a.published_at ?? "",
        a.url ?? "",
        a.relevance_score ?? "",
      ]);
    }
    const articleWs = XLSX.utils.aoa_to_sheet(articleRows);
    XLSX.utils.book_append_sheet(wb, articleWs, "Articles");

    // Summary sheet
    const articleCountByIdentifier: Record<string, { count: number; lastFetched: string | null }> = {};
    for (const a of articles ?? []) {
      if (!articleCountByIdentifier[a.identifier]) {
        articleCountByIdentifier[a.identifier] = { count: 0, lastFetched: null };
      }
      articleCountByIdentifier[a.identifier].count++;
      const fa = a.fetched_at;
      if (fa && (!articleCountByIdentifier[a.identifier].lastFetched || fa > articleCountByIdentifier[a.identifier].lastFetched!)) {
        articleCountByIdentifier[a.identifier].lastFetched = fa;
      }
    }

    const summaryRows: (string | number | null)[][] = [
      ["Identifier", "Type", "Display Name", "Article Count", "Last Fetched"],
    ];
    for (const e of entries) {
      const stats = articleCountByIdentifier[e.identifier];
      summaryRows.push([
        e.identifier,
        e.type,
        e.display_name ?? "",
        stats?.count ?? 0,
        stats?.lastFetched ?? "",
      ]);
    }
    const summaryWs = XLSX.utils.aoa_to_sheet(summaryRows);
    XLSX.utils.book_append_sheet(wb, summaryWs, "Summary");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    console.log(`[watchlist-xlsx] ${(articles ?? []).length} article rows exported`);

    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="signalera-watchlist-${date}.xlsx"`,
      },
    });
  } catch (e) {
    console.error("[watchlist-xlsx GET] error:", e);
    return new NextResponse("Internal error", { status: 500 });
  }
}

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
    const { data: entries, error: entriesError } = await supabase
      .from("watchlist")
      .select("identifier, type, display_name, sort_order, created_at")
      .eq("user_id", user.id)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });

    /* A FILE THAT LOOKS COMPLETE AND IS NOT IS WORSE THAN A FAILED DOWNLOAD,
       because the reader keeps it and cites it later. Both reads in this
       route used to discard their error, so a fault produced a workbook with
       a header row and nothing under it: byte for byte the same file this
       route writes for a reader whose watchlist is genuinely empty. Nothing
       downstream could tell those two apart, least of all the person holding
       the spreadsheet. Now a fault writes no file at all. */
    if (entriesError) throw entriesError;

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

    const { data: articles, error: articlesError } = await supabase
      .from("watchlist_articles")
      .select("identifier, title, source, published_at, relevance_score, url, fetched_at")
      .in("identifier", identifiers)
      .gte("published_at", thirtyDaysAgo)
      .order("identifier", { ascending: true })
      .order("published_at", { ascending: false })
      .limit(2000);

    // Same rule as the entries read above: an Articles sheet that is empty
    // because the read faulted must never ship as an Articles sheet that is
    // empty because there is no coverage.
    if (articlesError) throw articlesError;

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
    // Deduplicate by identifier using a Map keyed on identifier, then sort by count desc
    const summaryMap = new Map<string, { type: string; display_name: string | null; count: number; lastFetched: string | null }>();
    for (const e of entries) {
      if (!summaryMap.has(e.identifier)) {
        const stats = articleCountByIdentifier[e.identifier];
        summaryMap.set(e.identifier, {
          type: e.type,
          display_name: e.display_name ?? null,
          count: stats?.count ?? 0,
          lastFetched: stats?.lastFetched ?? null,
        });
      }
    }
    const summaryEntries = Array.from(summaryMap.entries()).sort(([, a], [, b]) => b.count - a.count);
    for (const [identifier, stats] of summaryEntries) {
      summaryRows.push([
        identifier,
        stats.type,
        stats.display_name ?? "",
        stats.count,
        stats.lastFetched ?? "",
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
    console.error("[watchlist-xlsx GET] read did not answer:", e);
    return new NextResponse(
      "Could not read the watchlist. No file was written.",
      { status: 500 },
    );
  }
}

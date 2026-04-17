import { NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

function escapeCsv(val: string | null | undefined): string {
  if (val == null) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

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

    if (!entries || entries.length === 0) {
      const csv = "Identifier,Type,Display Name,Title,Source,Published,Relevance,Summary,URL\n";
      const date = new Date().toISOString().split("T")[0];
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="signalera-watchlist-${date}.csv"`,
        },
      });
    }

    const identifiers = entries.map((e) => e.identifier);
    const { data: articles } = await supabase
      .from("watchlist_articles")
      .select("identifier, title, source, published_at, relevance_score, summary, url")
      .in("identifier", identifiers)
      .order("identifier", { ascending: true })
      .order("relevance_score", { ascending: false })
      .limit(500);

    const entryMap: Record<string, { type: string; display_name: string | null }> = {};
    for (const e of entries) {
      entryMap[e.identifier] = { type: e.type, display_name: e.display_name };
    }

    const headers = ["Identifier", "Type", "Display Name", "Title", "Source", "Published", "Relevance Score", "Summary", "URL"];
    const rows: string[][] = [headers];

    for (const a of articles ?? []) {
      const entry = entryMap[a.identifier];
      rows.push([
        escapeCsv(a.identifier),
        escapeCsv(entry?.type),
        escapeCsv(entry?.display_name),
        escapeCsv(a.title),
        escapeCsv(a.source),
        escapeCsv(a.published_at),
        escapeCsv(String(a.relevance_score ?? "")),
        escapeCsv(a.summary),
        escapeCsv(a.url),
      ]);
    }

    const csv = rows.map((r) => r.join(",")).join("\n");
    const date = new Date().toISOString().split("T")[0];

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="signalera-watchlist-${date}.csv"`,
      },
    });
  } catch (e) {
    console.error("[watchlist-xlsx GET] error:", e);
    return new NextResponse("Internal error", { status: 500 });
  }
}

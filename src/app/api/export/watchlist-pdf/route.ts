import { NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

function parseSignal(briefText: string | null): string | null {
  if (!briefText) return null;
  const signalMatch = briefText.match(/\*\*SIGNAL\*\*\s*([\s\S]+?)(?:\n\n|\n\*\*|$)/i);
  return signalMatch ? signalMatch[1].trim() : null;
}

export async function GET() {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    // Fetch watchlist entries
    const { data: entries, error: entriesError } = await supabase
      .from("watchlist")
      .select("id, identifier, type, display_name, sort_order, created_at")
      .eq("user_id", user.id)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });

    if (entriesError) throw entriesError;
    if (!entries || entries.length === 0) {
      return NextResponse.json({ entries: [], exportedAt: new Date().toISOString() });
    }

    const identifiers = entries.map((e) => e.identifier);

    // Fetch briefs, notes, top-3 articles for each entry
    const [briefsRes, notesRes, articlesRes] = await Promise.all([
      supabase.from("watchlist_briefs").select("identifier, brief_text, generated_at").in("identifier", identifiers),
      supabase.from("watchlist_notes").select("identifier, note_text").eq("user_id", user.id).in("identifier", identifiers),
      // For top-3 articles per entry we need a cross-entry query
      supabase.from("watchlist_articles").select("identifier, title, source, published_at, relevance_score").in("identifier", identifiers).order("relevance_score", { ascending: false }),
    ]);

    const briefsByIdent: Record<string, { brief_text: string; generated_at: string }> = {};
    for (const b of briefsRes.data ?? []) {
      briefsByIdent[b.identifier] = b;
    }

    const notesByIdent: Record<string, string> = {};
    for (const n of notesRes.data ?? []) {
      notesByIdent[n.identifier] = n.note_text;
    }

    // Group top-3 articles per identifier
    const articlesByIdent: Record<string, { title: string; source: string | null; published_at: string | null }[]> = {};
    for (const a of articlesRes.data ?? []) {
      if (!articlesByIdent[a.identifier]) articlesByIdent[a.identifier] = [];
      if (articlesByIdent[a.identifier].length < 3) {
        articlesByIdent[a.identifier].push({ title: a.title, source: a.source, published_at: a.published_at });
      }
    }

    const result = entries.map((entry) => ({
      ...entry,
      signal: parseSignal(briefsByIdent[entry.identifier]?.brief_text ?? null),
      note: notesByIdent[entry.identifier] ?? null,
      topArticles: articlesByIdent[entry.identifier] ?? [],
    }));

    return NextResponse.json({ entries: result, exportedAt: new Date().toISOString() });
  } catch (e) {
    console.error("[watchlist-pdf GET] error:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

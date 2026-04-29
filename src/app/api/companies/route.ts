import { NextRequest, NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export interface Company {
  id: string;
  name: string;
  ticker: string | null;
  sector: string | null;
  mention_count: number;
  last_updated: string | null;
  key_themes: string[] | null;
}

// Quality filter for noise rows that survive the SQL-level filters.
// Pure-noise patterns flagged: all-numeric, all-punctuation, all-lowercase short.
function isNoiseName(name: string): boolean {
  const trimmed = name.trim();
  // No alphabetic characters → all-numeric or all-punctuation
  if (!/[A-Za-z]/.test(trimmed)) return true;
  // All-lowercase letters/spaces and shorter than 5 chars (e.g. "abc", "foo")
  if (/^[a-z\s]+$/.test(trimmed) && trimmed.length < 5) return true;
  return false;
}

export async function GET(request: NextRequest) {
  const { supabase } = await getSupabaseWithUser();
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  const limitRaw = parseInt(searchParams.get("limit") ?? "500", 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 1000) : 500;

  try {
    let query = supabase
      .from("companies")
      .select("id, name, ticker, sector, mention_count, last_updated, key_themes")
      .not("name", "is", null)
      // Loosened from `> 0` to `IS NOT NULL` after Vercel preview showed too few rows
      // (~25-30 vs. pre-rewrite hundreds). Singletons are still real companies a user
      // might search for. SQL noise protection moved to the JS post-fetch filter below.
      .not("mention_count", "is", null)
      .order("mention_count", { ascending: false, nullsFirst: false })
      .order("last_updated", { ascending: false, nullsFirst: false })
      .order("name", { ascending: true })
      .limit(limit);

    if (q.length >= 2) {
      // Name-only ilike. Ticker filtering deliberately omitted — column reliability
      // is unverified per the fix plan; revisit in a follow-up.
      query = query.ilike("name", `%${q}%`);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[api/companies] query error:", error.message);
      return NextResponse.json({ companies: [], total: 0, error: error.message });
    }

    const rows = (data ?? []) as Company[];

    const filtered = rows.filter((c) => {
      const name = (c.name ?? "").trim();
      if (name.length < 2) return false;
      if (isNoiseName(name)) return false;
      return true;
    });

    // Diagnostic: warn when the JS noise filter drops > 30% of rows. Percentage-based
    // so the threshold scales with the larger default limit (500 → could be 1000).
    if (rows.length > 0 && (rows.length - filtered.length) / rows.length > 0.30) {
      const dropped = rows.filter((c) => !filtered.includes(c)).slice(0, 5).map((c) => c.name);
      console.warn(
        `[api/companies] post-fetch quality filter reduced ${rows.length} → ${filtered.length} rows (>30% dropped). First 5 filtered names:`,
        dropped,
      );
    }

    return NextResponse.json({ companies: filtered, total: filtered.length });
  } catch (e) {
    console.error("[api/companies] unexpected error:", e);
    return NextResponse.json({
      companies: [],
      total: 0,
      error: e instanceof Error ? e.message : "unknown error",
    });
  }
}

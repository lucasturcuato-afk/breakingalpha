import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseWithUser } from "@/lib/supabase-server";

// ---------------------------------------------------------------------------
// /api/memo-cache
// ---------------------------------------------------------------------------
// BriefTab queries this endpoint on mount. If a Markdown memo for the
// company was generated within the last 24 hours, return the cached
// payload so we do not burn a Gemini call (and rate-limit slot) on every
// visit. On miss, BriefTab renders a Generate Brief CTA that POSTs
// /api/memo; the route's after() hook records the freeform memo via
// output_log_v0_stub.metadata.markdown_memo for the next visit.

const CACHE_TTL_HOURS = 24;

// WD70: keep aligned with MEMO_REGENERATIONS_PER_DAY in /api/memo/route.ts.
// Surfaced here so BriefTab can render `Regenerate (N/3 today)` on the same
// cache-check it already does on mount.
const MEMO_REGENERATIONS_PER_DAY = 3;

interface CacheRow {
  generated_at: string;
  metadata: {
    markdown_memo?: unknown;
  } | null;
}

function todayUtcMidnightISO(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

async function computeRegenerationsRemaining(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("user_memo_regeneration_quota")
    .select("user_id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("regenerated_at", todayUtcMidnightISO());
  if (error) {
    // If the table is missing (migration not yet run) or query fails, fall
    // back to the full quota so the UI does not falsely show zero.
    console.warn("[memo-cache] quota count failed:", error.message);
    return MEMO_REGENERATIONS_PER_DAY;
  }
  return Math.max(0, MEMO_REGENERATIONS_PER_DAY - (count ?? 0));
}

export async function GET(request: NextRequest) {
  const { supabase: userSupabase, user } = await getSupabaseWithUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const companyId = request.nextUrl.searchParams.get("company_id");
  if (!companyId || companyId.length === 0) {
    return NextResponse.json({ error: "company_id is required" }, { status: 400 });
  }

  const regenerationsRemaining = await computeRegenerationsRemaining(userSupabase, user.id);

  try {
    // Service-role client; output_log_v0_stub is not user-scoped at the row level.
    const svc = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    const cutoff = new Date(Date.now() - CACHE_TTL_HOURS * 60 * 60 * 1000).toISOString();
    const { data, error } = await svc
      .from("output_log_v0_stub")
      .select("generated_at, metadata")
      .eq("output_type", "memo")
      .eq("source_table", "companies")
      .eq("source_id", companyId)
      .eq("metadata->>variant", "articles")
      .eq("metadata->>user_id", user.id)
      .gte("generated_at", cutoff)
      .order("generated_at", { ascending: false })
      .limit(10);

    if (error) {
      console.error("[memo-cache] select failed:", error.message);
      return NextResponse.json({
        cached: false,
        regenerations_remaining_today: regenerationsRemaining,
      });
    }

    const rows = (data ?? []) as CacheRow[];
    for (const row of rows) {
      const meta = row.metadata;
      if (!meta || typeof meta !== "object") continue;
      const markdownRaw = meta.markdown_memo;
      if (typeof markdownRaw !== "string" || markdownRaw.length === 0) continue;
      return NextResponse.json({
        cached: true,
        markdown: markdownRaw,
        generated_at: row.generated_at,
        regenerations_remaining_today: regenerationsRemaining,
      });
    }

    return NextResponse.json({
      cached: false,
      regenerations_remaining_today: regenerationsRemaining,
    });
  } catch (err) {
    console.error("[memo-cache] error:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({
      cached: false,
      regenerations_remaining_today: regenerationsRemaining,
    });
  }
}

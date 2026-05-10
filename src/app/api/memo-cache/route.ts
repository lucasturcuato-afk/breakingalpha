import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
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

interface CacheRow {
  generated_at: string;
  metadata: {
    markdown_memo?: unknown;
  } | null;
}

export async function GET(request: NextRequest) {
  const { user } = await getSupabaseWithUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const companyId = request.nextUrl.searchParams.get("company_id");
  if (!companyId || companyId.length === 0) {
    return NextResponse.json({ error: "company_id is required" }, { status: 400 });
  }

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
      .gte("generated_at", cutoff)
      .order("generated_at", { ascending: false })
      .limit(10);

    if (error) {
      console.error("[memo-cache] select failed:", error.message);
      return NextResponse.json({ cached: false });
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
      });
    }

    return NextResponse.json({ cached: false });
  } catch (err) {
    console.error("[memo-cache] error:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ cached: false });
  }
}

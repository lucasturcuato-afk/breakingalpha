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
// /api/memo; the route's recordOutput call persists the freeform memo to
// the `outputs` table for the next visit.
//
// WD139: read path repointed from output_log_v0_stub to `outputs` after
// #259 consolidated the memo write target. Lucas's merge resolution dropped
// the legacy stub writes (Pattern A after() hook) but the cache reads were
// not migrated alongside, so /api/memo-cache returned cached:false on every
// memo view from 2026-05-24 15:55 UTC onward. Match key is
// content->>'target_company' (populated by the WD126 server-side resolver
// for every memo write path that knows the company; null-company writes are
// legitimately skipped because the writer had no company anchor).

const CACHE_TTL_HOURS = 24;

// WD70: keep aligned with MEMO_REGENERATIONS_PER_DAY in /api/memo/route.ts.
// Surfaced here so BriefTab can render `Regenerate (N/3 today)` on the same
// cache-check it already does on mount.
const MEMO_REGENERATIONS_PER_DAY = 3;

interface CacheRow {
  created_at: string;
  content: {
    memo_text?: unknown;
    memo_type?: unknown;
  } | null;
}

// Memo types eligible for the BriefTab cache. BriefTab writes 'company';
// only those rows are real company briefs.
//
// 'article' was previously eligible as a defensive catch for modal-driven
// flows that defaulted to 'article'. That catch is vestigial: the only
// company-anchored modal (CompanyIntelMemoModal) has no live hosts, and no
// memo_type='article' row has ever carried content->>'target_company' (all
// article memos persisted target_company=null), so 'article' eligibility has
// never matched a row. It must be dropped now because article surfaces
// (story cards, feed rows, watchlist article modals) are starting to thread
// their subject company through a COMPANY: content line for outcome grading;
// without this narrowing, a story memo about NVIDIA would surface as the
// user's cached NVIDIA company brief within the 24h TTL.
const ELIGIBLE_MEMO_TYPES = new Set(["company"]);

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
    // Service-role client; outputs RLS is row-level user_id scoped but we
    // filter explicitly on user_id below so the service role only acts as
    // an RLS bypass for clean indexed lookups.
    const svc = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    const cutoff = new Date(Date.now() - CACHE_TTL_HOURS * 60 * 60 * 1000).toISOString();
    // WD139: filter by target_company in the query (indexed JSONB path lookup),
    // then filter memo_type in JS so the SQL stays a single eq chain. memo_type
    // eligibility is per ELIGIBLE_MEMO_TYPES above.
    const { data, error } = await svc
      .from("outputs")
      .select("created_at, content")
      .eq("output_type", "memo")
      .eq("user_id", user.id)
      .eq("content->>target_company", companyId)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
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
      const content = row.content;
      if (!content || typeof content !== "object") continue;
      const memoType = content.memo_type;
      if (typeof memoType !== "string" || !ELIGIBLE_MEMO_TYPES.has(memoType)) continue;
      const memoText = content.memo_text;
      if (typeof memoText !== "string" || memoText.length === 0) continue;
      return NextResponse.json({
        cached: true,
        markdown: memoText,
        generated_at: row.created_at,
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

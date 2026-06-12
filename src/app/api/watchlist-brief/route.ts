/**
 * GET /api/watchlist-brief?type=morning|evening
 *
 * Returns the current user's personalized watchlist bullet section for the top
 * of the brief. Per-user authed and FAIL-CLOSED: with no authenticated user we
 * return 401 and an empty section, never another user's data. The work is pure
 * assembly off pre-computed article fields (see src/lib/watchlist-brief.ts) so
 * there is no model call in this path and cost stays flat as users grow.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import {
  getWatchlistBullets,
  type WatchlistBriefSection,
} from "@/lib/watchlist-brief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMPTY: WatchlistBriefSection = { state: "empty", bullets: [] };

export async function GET(request: NextRequest) {
  const { supabase, user } = await getSupabaseWithUser();

  // Fail closed: never serve a watchlist section without a verified user.
  if (!user) {
    return NextResponse.json(
      { ...EMPTY, error: "Not authenticated" },
      { status: 401 },
    );
  }

  const briefType =
    request.nextUrl.searchParams.get("type") === "evening"
      ? "evening"
      : "morning";

  // The lib is fail-soft (returns a safe section, never throws), but guard the
  // route too so a section failure can never 500 the brief page.
  try {
    const section = await getWatchlistBullets(supabase, user.id, briefType);
    return NextResponse.json(section, { status: 200 });
  } catch (e) {
    console.error("[watchlist-brief route] unexpected error:", e);
    return NextResponse.json(EMPTY, { status: 200 });
  }
}

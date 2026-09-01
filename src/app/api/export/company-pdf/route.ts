/**
 * GET /api/export/company-pdf?identifier=<identifier>
 *
 * Returns the caller's watchlist entry for an identifier plus the cached
 * articles and brief behind it.
 *
 * WHAT WAS WRONG
 * --------------
 * The route authenticated the caller and then threw that context away. It
 * built a second, unauthenticated Supabase client from the anon key and read
 * `watchlist_articles` and `watchlist_briefs` keyed on nothing but the
 * `identifier` query parameter:
 *
 *   const anonSupabase = getAnonSupabase();
 *   anonSupabase.from("watchlist_briefs").select(...).eq("identifier", identifier)
 *
 * Only the `entry` read was scoped to the user. So any signed-in caller could
 * name any identifier and receive the cached brief and the top 15 articles
 * behind somebody else's watchlist row, for an identifier they do not watch.
 * There was no ownership check.
 *
 * It also selected `generated_at` and never looked at it, so it served briefs
 * of any age. src/app/watchlist/[identifier]/page.tsx refuses to render a
 * brief older than 12 hours; this route handed out the same row regardless.
 *
 * WHAT CHANGED
 * ------------
 * 1. Ownership. The cached artifacts are served only when the identifier is
 *    on the caller's own watchlist, and the gate runs BEFORE the cache reads.
 *    The response shape is unchanged, so callers that already handle the
 *    entry-is-null case keep working.
 * 2. One client. The anon client is gone; the authenticated client does every
 *    read. The route no longer holds an unauthenticated handle at all.
 * 3. TTL. A stale brief is dropped rather than exported, using the same
 *    12-hour window the watchlist page enforces
 *    (src/lib/watchlist-brief-ttl.ts).
 *
 * The decision and the reads live in src/lib/company-export.ts so they can be
 * run against a fake client in tests/unit/company-export-ownership.test.ts.
 *
 * STILL OPEN, NOT FIXABLE HERE
 * ----------------------------
 * `watchlist_briefs` and `watchlist_articles` carry
 * `Public read/insert/update/delete USING (true)` from
 * backend/watchlist_articles_schema.sql:44-50,69-75. The anon key ships to the
 * browser, so both tables are world-readable AND world-writable directly
 * through PostgREST without touching this route. Verified by anon-key probe on
 * 2026-08-31. This file cannot close that; the migration that can is
 * sql/0034_watchlist_cache_rls_hardening.sql, written and NOT APPLIED.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { loadCompanyExport, type ExportClient } from "@/lib/company-export";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const identifier = request.nextUrl.searchParams.get("identifier");
  if (!identifier) {
    return NextResponse.json({ error: "identifier required" }, { status: 400 });
  }

  const { supabase, user } = await getSupabaseWithUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const payload = await loadCompanyExport(
      supabase as unknown as ExportClient,
      user.id,
      identifier,
    );
    return NextResponse.json(payload);
  } catch (e) {
    console.error("[company-pdf GET] error:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

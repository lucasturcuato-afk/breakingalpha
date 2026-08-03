import { NextRequest, NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { matchFollow, type FollowRow } from "@/lib/radar-following";

export const dynamic = "force-dynamic";

/**
 * Following feed: matches every un-muted follow against the ingested
 * corpus (see radar-following.ts). No external API calls, ever. Muted
 * follows are returned without articles so the tab can render them in
 * the "Also watching" collapse.
 *
 * Degrades gracefully: missing follows table -> { developments: [],
 * unavailable: true }; per-follow match errors -> empty article list.
 */

export async function GET(request: NextRequest) {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const daysParam = Number(request.nextUrl.searchParams.get("days"));
  const days = Number.isFinite(daysParam) && daysParam > 0 && daysParam <= 30 ? daysParam : 7;

  const { data: follows, error } = await supabase
    .from("follows")
    .select("id, follow_type, target, display_name, matched_keywords, embedding, muted, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (error) {
    const missing = error.code === "42P01" || /does not exist/i.test(error.message ?? "");
    return NextResponse.json(
      { developments: [], unavailable: missing },
      { status: missing ? 200 : 500 },
    );
  }

  const rows = (follows ?? []) as FollowRow[];
  const developments = await Promise.all(
    rows.map(async (follow) => {
      const meta = {
        id: follow.id,
        follow_type: follow.follow_type,
        target: follow.target,
        display_name: follow.display_name,
        muted: follow.muted,
      };
      if (follow.muted) return { follow: meta, articles: [], failed: false };
      try {
        return { follow: meta, articles: await matchFollow(supabase, follow, days), failed: false };
      } catch (e) {
        // One bad follow must not take down the whole feed, but it must also
        // not masquerade as a quiet follow. Mark it so the UI can say the
        // matching failed instead of reporting "nothing matched".
        console.error("[following-feed] match failed for follow", follow.id, e);
        return { follow: meta, articles: [], failed: true };
      }
    }),
  );

  return NextResponse.json({ developments });
}

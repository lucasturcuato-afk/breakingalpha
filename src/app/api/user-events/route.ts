import { NextRequest, NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { trackEvent, type UserEventType } from "@/lib/user-profile";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_TYPES: UserEventType[] = [
  "thesis_viewed",
  "thesis_dismissed",
  "thesis_approved",
  "memo_generated",
  "morning_brief_opened",
  "evening_wrap_opened",
  "pattern_clicked",
  "watchlist_added",
  "watchlist_removed",
  "sector_filter_applied",
  "onboarding_completed",
];

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await getSupabaseWithUser();
    if (!user) {
      // Don't 401 — this is fire-and-forget and a 401 would spam the console.
      return NextResponse.json({ ok: false, reason: "unauthenticated" }, { status: 204 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      event_type?: UserEventType;
      payload?: Record<string, unknown>;
    };

    if (!body.event_type || !VALID_TYPES.includes(body.event_type)) {
      return NextResponse.json(
        { ok: false, reason: "invalid event_type" },
        { status: 400 },
      );
    }

    await trackEvent(supabase, user.id, body.event_type, body.payload ?? {});
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.warn("[user-events] error:", err);
    // Never let event tracking break the caller.
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}

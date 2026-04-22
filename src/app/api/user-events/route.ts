import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import type { UserEventType } from "@/lib/user-profile";

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
  "brief_section_rated",
];

export async function POST(request: NextRequest) {
  try {
    const { user } = await getSupabaseWithUser();
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

    // Use service role client to bypass RLS on user_events table
    const adminSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    const { error } = await adminSupabase.from("user_events").insert({
      user_id: user.id,
      event_type: body.event_type,
      payload: body.payload ?? {},
    });

    if (error) {
      console.error("[user-events] insert failed:", error.message);
      return NextResponse.json({ ok: false, reason: error.message }, { status: 200 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.warn("[user-events] error:", err);
    // Never let event tracking break the caller.
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}

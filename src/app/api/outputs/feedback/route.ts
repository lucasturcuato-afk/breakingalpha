import { NextRequest, NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";

interface FeedbackEvent {
  output_id: string;
  dwell_seconds?: number;
  scroll_depth?: number;
  entered_viewport?: boolean;
  exited_viewport?: boolean;
  clicked_source?: boolean;
  dismissed?: boolean;
  followup_generated?: boolean;
  saved?: boolean;
  shared?: boolean;
  exported?: boolean;
  thumbs?: "up" | "down" | null;
  text_feedback?: string;
}

const ALLOWED_FIELDS = [
  "dwell_seconds",
  "scroll_depth",
  "entered_viewport",
  "exited_viewport",
  "clicked_source",
  "dismissed",
  "followup_generated",
  "saved",
  "shared",
  "exported",
  "thumbs",
  "text_feedback",
] as const;

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await getSupabaseWithUser();
    if (!user) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    const events: FeedbackEvent[] = await req.json();
    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ error: "empty payload" }, { status: 400 });
    }
    if (events.length > 50) {
      return NextResponse.json({ error: "batch too large" }, { status: 400 });
    }

    const results = await Promise.all(
      events.map(async (ev) => {
        if (!ev.output_id || typeof ev.output_id !== "string") {
          return { ok: false, reason: "missing output_id" };
        }

        const payload: Record<string, unknown> = {
          output_id: ev.output_id,
          user_id: user.id,
        };
        for (const f of ALLOWED_FIELDS) {
          if (ev[f] !== undefined) payload[f] = ev[f];
        }
        if (ev.thumbs !== undefined) {
          payload.thumbs_at = new Date().toISOString();
        }

        const { error } = await supabase
          .from("output_user_feedback")
          .upsert(payload, { onConflict: "output_id,user_id" });

        if (error) {
          console.error("[feedback] upsert error:", error.message);
          return { ok: false, reason: error.message };
        }
        return { ok: true };
      }),
    );

    const failed = results.filter((r) => !r.ok).length;
    return NextResponse.json({ accepted: results.length - failed, failed });
  } catch (e) {
    console.error("[feedback] handler error:", e);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

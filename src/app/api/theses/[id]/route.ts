import { NextRequest, NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set([
  "new-signal",
  "exploring",
  "draft-thesis",
  "needs-evidence",
  "ready-for-memo",
  "pending_review",
  "active",
  "watch",
  "archived",
]);

const VALID_CONVICTIONS = new Set([
  "HIGH",
  "MEDIUM",
  "WATCH",
  "BULLISH",
  "BEARISH",
]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;

  try {
    const body = await request.json();
    const { status, conviction } = body as { status?: string; conviction?: string };

    const update: Record<string, string> = {};

    if (status) {
      if (!VALID_STATUSES.has(status)) {
        return NextResponse.json({ error: `Invalid status: ${status}` }, { status: 400 });
      }
      update.status = status;
    }

    if (conviction) {
      if (!VALID_CONVICTIONS.has(conviction)) {
        return NextResponse.json({ error: `Invalid conviction: ${conviction}` }, { status: 400 });
      }
      update.conviction = conviction;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("theses")
      .update(update)
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      console.error("[theses/[id] PATCH] update failed:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ thesis: data });
  } catch (e) {
    console.error("[theses/[id] PATCH] error:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

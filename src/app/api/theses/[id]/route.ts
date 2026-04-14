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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;

  try {
    const body = await request.json();
    const { status } = body as { status?: string };

    if (!status || !VALID_STATUSES.has(status)) {
      return NextResponse.json(
        { error: `Invalid status: ${status}` },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("theses")
      .update({ status })
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

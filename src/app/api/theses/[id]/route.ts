import { NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;

  try {
    const body = await request.json();
    console.log("PATCH thesis", id, body);

    const updateData: Record<string, string> = {};
    if (body.status) updateData.status = body.status;
    if (body.conviction) updateData.conviction = body.conviction;

    if (Object.keys(updateData).length === 0) {
      return Response.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("theses")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("PATCH supabase error", error);
      return Response.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return Response.json({ thesis: data });
  } catch (e) {
    console.error("[theses/[id] PATCH] error:", e);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}

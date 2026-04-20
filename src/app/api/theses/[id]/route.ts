import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { mapThesisRow } from "@/lib/thesis-mapper";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );

  const { id } = await params;
  const body = await request.json();

  const updateData: Record<string, string> = {};
  if (body.status) updateData.status = body.status;
  if (body.conviction) updateData.conviction = body.conviction;

  if (Object.keys(updateData).length === 0) {
    return Response.json(
      { error: "No fields to update" },
      { status: 400 }
    );
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("theses")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    console.log("Supabase result:", JSON.stringify({ data, error }));

    if (error) throw error;
    // Use single-source-of-truth mapper so the single route returns the
    // same shape the bulk route returns.
    const mapped = data ? mapThesisRow(data as Parameters<typeof mapThesisRow>[0]) : null;
    return Response.json({ thesis: mapped });
  } catch (e) {
    console.error("=== PATCH FAILED ===", JSON.stringify(e));
    return Response.json(
      { error: String(e) },
      { status: 500 }
    );
  }
}

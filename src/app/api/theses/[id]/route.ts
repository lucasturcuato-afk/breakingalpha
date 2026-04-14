import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseWithUser } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

// Service-role client bypasses RLS — appropriate for authenticated user actions
// routed through this server-only endpoint. Falls back to anon key if no
// SUPABASE_SERVICE_ROLE_KEY is set (RLS must then allow UPDATE for the user).
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
);

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    "[theses PATCH] SUPABASE_SERVICE_ROLE_KEY not set — using anon key.\n" +
    "If UPDATE fails due to RLS, run this in Supabase SQL editor:\n" +
    "  CREATE POLICY \"allow_authenticated_update\" ON theses\n" +
    "  FOR UPDATE TO authenticated\n" +
    "  USING (true) WITH CHECK (true);"
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();

  console.log("=== PATCH START ===");
  console.log("id:", id);
  console.log("body:", JSON.stringify(body));

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
    return Response.json({ thesis: data });
  } catch (e) {
    console.error("=== PATCH FAILED ===", JSON.stringify(e));
    return Response.json(
      { error: String(e) },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { mapThesisRow } from "@/lib/thesis-mapper";
import { getServiceSupabase } from "@/lib/supabase-service";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Auth: accept either an internal-key (CLI / cron / system path) reusing the
  // exact pattern from theses/backfill-tickers/route.ts, or a logged-in user.
  // The internal key path is treated as an admin and may update any thesis,
  // including global/system rows whose user_id is NULL.
  const internalKey = request.headers.get("x-internal-key");
  const isInternal = Boolean(internalKey) && internalKey === process.env.INTERNAL_API_KEY;

  let userId: string | null = null;
  if (!isInternal) {
    const { user } = await getSupabaseWithUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    userId = user.id;
  }

  // Service-role client: bypasses RLS so the write succeeds even though the
  // theses table currently has no UPDATE policy. Ownership is enforced in code
  // below (see the ownership guard) rather than via RLS.
  const supabaseAdmin = getServiceSupabase();

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

  // Ownership guard (IDOR fix): fetch the target thesis first and confirm the
  // caller is allowed to mutate it. Internal-key callers are admins and skip
  // this check. A logged-in user may only update a thesis they own; rows owned
  // by another user OR global/system rows (user_id NULL) are rejected with 403
  // so normal users cannot mutate theses that are not theirs.
  if (!isInternal) {
    const { data: existing, error: lookupError } = await supabaseAdmin
      .from("theses")
      .select("id, user_id")
      .eq("id", id)
      .single();

    /* A FAILED READ IS NOT A MISSING ROW, and this one gated a WRITE. `.single()`
       answers with an error object rather than throwing, and PGRST116 is the one
       code that means the query ran and matched nothing. Every other code is a
       read that did not answer, and answering that with 404 "Thesis not found"
       tells the caller their thesis is gone when the lookup simply dropped. */
    if (lookupError && lookupError.code !== "PGRST116") {
      console.error("[theses PATCH] ownership lookup failed:", lookupError.message);
      return Response.json({ error: "Could not verify this thesis" }, { status: 503 });
    }

    if (!existing) {
      return Response.json({ error: "Thesis not found" }, { status: 404 });
    }

    if (existing.user_id !== userId) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  try {
    let query = supabaseAdmin
      .from("theses")
      .update(updateData)
      .eq("id", id);
    // Defense in depth: for user callers also scope the write to their own
    // user_id so a concurrent ownership change cannot widen the blast radius.
    if (!isInternal) {
      query = query.eq("user_id", userId as string);
    }

    const { data, error } = await query
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

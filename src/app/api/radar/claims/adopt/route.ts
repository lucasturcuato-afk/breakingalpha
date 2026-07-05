import { NextRequest, NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/**
 * Adopt-from-brief: one tap copies a brief call into the user's tracked
 * calls with adopted provenance. Adopted claims are NEVER re-graded;
 * their verdict is the original call's morning_brief_call_outcomes row,
 * joined at read time. The brief's claim text is preserved verbatim.
 */

export async function POST(request: NextRequest) {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { call_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const callId = (body.call_id ?? "").trim();
  if (!callId) return NextResponse.json({ error: "call_id required" }, { status: 400 });

  const { data: call, error: callError } = await supabase
    .from("morning_brief_calls")
    .select("id, claim_text, claim_type, target_symbol, expected_direction, brief_date")
    .eq("id", callId)
    .maybeSingle();
  if (callError || !call) {
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }

  // Idempotent: adopting the same call twice returns the existing row.
  const { data: existing } = await supabase
    .from("user_claims")
    .select("id")
    .eq("user_id", user.id)
    .eq("adopted_from_call_id", callId)
    .maybeSingle();
  if (existing) return NextResponse.json({ id: existing.id, alreadyAdopted: true });

  const { data, error } = await supabase
    .from("user_claims")
    .insert({
      user_id: user.id,
      user_claim: call.claim_text,
      claim_type: call.claim_type,
      target_symbol: call.target_symbol,
      expected_direction: call.expected_direction,
      resolution_method: {
        method: "price_attribution",
        version: 1,
        adopted: true,
        graded_by: "original brief call",
      },
      resolution_window_start: call.brief_date,
      resolution_window_end: call.brief_date,
      evidence_entities: call.target_symbol ? [call.target_symbol] : [],
      // Not independently graded: the verdict joins through to the
      // original brief outcome.
      gradeable: false,
      gradeability_note:
        "Adopted from the brief; the verdict is the original call's grading.",
      status: "open",
      source: "adopted",
      adopted_from_call_id: callId,
    })
    .select("id")
    .single();

  if (error) {
    const missing = error.code === "42P01" || /does not exist/i.test(error.message ?? "");
    if (missing) {
      return NextResponse.json(
        { error: "Calls are not set up yet (migration pending)." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ id: data.id });
}

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { todayPt } from "@/lib/session-date";
import {
  DEFAULT_ADOPT_HORIZON,
  MAX_WINDOW_DAYS,
  isPriceableClaimType,
  normalizeAdoptHorizon,
  resolveAdoptWindow,
} from "@/lib/call-horizons";

export const dynamic = "force-dynamic";

/**
 * Adopt-from-brief: one tap copies a brief call into the user's tracked calls
 * with adopted provenance, AND gives it a real forward window of its own.
 *
 * An adopted claim used to be born with resolution_window_start ===
 * resolution_window_end === the brief's date, and gradeable hardcoded false.
 * That made it a bookmark: it could never resolve, and its verdict was always
 * the original call's. A coherent feature, but not "track this thesis".
 *
 * It is now a FORWARD claim from today. The window runs today -> today +
 * horizon (default one week, caller may override, capped at MAX_WINDOW_DAYS),
 * and gradeable is decided by the SAME server-side rules the authoring route
 * applies, never trusted from the client. adopted_from_call_id is still
 * written, so provenance and the original brief verdict stay joinable.
 */

export async function POST(request: NextRequest) {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { call_id?: string; horizon?: string; window_days?: number };
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

  // Forward from TODAY, not from the brief's date. Adopting a call made last
  // Tuesday means "I am taking this view now"; backdating the start would hand
  // the user sessions that already happened.
  // US market session date (Pacific), NOT the server's UTC date. A claim
  // adopted after ~5pm PT is still the same trading session; stamping UTC stored
  // the window a day ahead of what the user saw (see #543). One convention,
  // shared with every other surface via src/lib/session-date.ts.
  const todayIso = todayPt();
  const horizon = normalizeAdoptHorizon(body.horizon, DEFAULT_ADOPT_HORIZON);
  const windowEnd = resolveAdoptWindow(todayIso, horizon, body.window_days);

  // Server-side gradeability, mirroring src/app/api/radar/claims/author/route.ts.
  const symbol = typeof call.target_symbol === "string" ? call.target_symbol.trim() : "";
  const direction = call.expected_direction;
  const endsAfterToday = windowEnd > todayIso;
  const withinMax =
    (new Date(windowEnd).getTime() - new Date(todayIso).getTime()) / 86_400_000 <=
    MAX_WINDOW_DAYS;
  const gradeable =
    !!symbol &&
    !!direction &&
    endsAfterToday &&
    withinMax &&
    isPriceableClaimType(call.claim_type);

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
        adopted_horizon: horizon,
        // The claim text came from the brief; the window and the verdict are
        // the user's own from here.
        graded_by: gradeable ? "own window" : "not graded",
      },
      resolution_window_start: todayIso,
      resolution_window_end: windowEnd,
      evidence_entities: call.target_symbol ? [call.target_symbol] : [],
      gradeable,
      gradeability_note: gradeable
        ? null
        : "Tracked as context only: no priceable entity, direction, or bounded window.",
      status: "open",
      source: "adopted",
      adopted_from_call_id: callId,
    })
    .select("id, resolution_window_start, resolution_window_end, gradeable")
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
  return NextResponse.json({
    id: data.id,
    horizon,
    resolution_window_start: data.resolution_window_start,
    resolution_window_end: data.resolution_window_end,
    gradeable: data.gradeable,
  });
}

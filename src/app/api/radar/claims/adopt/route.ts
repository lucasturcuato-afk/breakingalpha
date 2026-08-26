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
 *
 * THE COMMIT NOTE. `commit_note` is ACCEPTED and NOT REQUIRED.
 *
 * The mobile commit sheet will not unlock its control below twelve characters,
 * and that rule lives in the CLIENT, on purpose. Desktop /radar/calls is going
 * to adopt the same requirement later, and when it does it needs no second
 * change here: it sends the field this route already takes. A route that
 * rejected a short note would also break every caller that has no note to send,
 * which today is every caller.
 *
 * WHAT THIS ROUTE DOES GUARANTEE is that the pair is coherent. `commit_note`
 * and `commit_note_at` are written in ONE object, from ONE decision, so a note
 * with no timestamp and a timestamp with no note are both unreachable. A client
 * cannot get that wrong because it is never asked to: it sends prose, and the
 * moment is stamped here.
 *
 * `commit_note_at` is when the NOTE was written, not when the row was created.
 * On the ordinary path they are the same instant. They are not on the second
 * path below, where a row already exists with no note on it and the note lands
 * afterwards, and that is exactly the case the separate column exists for.
 */

/**
 * A ceiling, not a floor. The floor is the client's. This only stops a single
 * request writing an unbounded blob into a column every ledger read selects.
 */
export const COMMIT_NOTE_MAX = 2000;

/**
 * The note as it will be stored, or null when there is nothing to store.
 *
 * Whitespace-only is nothing. An absent field is nothing. Both give back null,
 * and null is what makes the write below skip the timestamp too.
 */
function readCommitNote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, COMMIT_NOTE_MAX);
}

export async function POST(request: NextRequest) {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: {
    call_id?: string;
    horizon?: string;
    window_days?: number;
    commit_note?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const callId = (body.call_id ?? "").trim();
  if (!callId) return NextResponse.json({ error: "call_id required" }, { status: 400 });

  // Accepted, never required. See the header.
  const commitNote = readCommitNote(body.commit_note);

  const { data: call, error: callError } = await supabase
    .from("morning_brief_calls")
    .select("id, claim_text, claim_type, target_symbol, expected_direction, brief_date")
    .eq("id", callId)
    .maybeSingle();
  if (callError || !call) {
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }

  // Idempotent: adopting the same call twice gives back the existing row.
  //
  // This is also what makes a retry after an unacknowledged write safe. The
  // commit sheet cannot tell a dropped connection from a failed insert, so it
  // offers "Try again" for both; a second attempt lands here and finds the row
  // rather than creating a duplicate one.
  const { data: existing } = await supabase
    .from("user_claims")
    .select("id, commit_note")
    .eq("user_id", user.id)
    .eq("adopted_from_call_id", callId)
    .maybeSingle();
  if (existing) {
    // The row is already on the record. If it carries no reasoning and the
    // caller brought some, that is the case commit_note_at exists to describe:
    // the note is being written NOW, later than the row. Both columns move
    // together here for the same reason they do on the insert.
    if (commitNote && !existing.commit_note) {
      const { error: noteError } = await supabase
        .from("user_claims")
        .update({ commit_note: commitNote, commit_note_at: new Date().toISOString() })
        .eq("id", existing.id)
        .eq("user_id", user.id);
      if (noteError) {
        return NextResponse.json({ error: noteError.message }, { status: 500 });
      }
      return NextResponse.json({ id: existing.id, alreadyAdopted: true, noteWritten: true });
    }
    return NextResponse.json({
      id: existing.id,
      alreadyAdopted: true,
      noteWritten: Boolean(existing.commit_note),
    });
  }

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
      // ONE decision, TWO columns, one object. There is no ordering in which a
      // note lands without its timestamp or a timestamp without its note.
      commit_note: commitNote,
      commit_note_at: commitNote ? new Date().toISOString() : null,
    })
    .select("id, resolution_window_start, resolution_window_end, gradeable, commit_note")
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
    // Read back off the inserted row rather than echoed off the request, so a
    // caller that cares whether the reasoning is on the record is told by the
    // database and not by its own optimism.
    noteWritten: Boolean(data.commit_note),
  });
}

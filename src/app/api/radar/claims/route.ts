import { NextRequest, NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { loadRadarClaims } from "@/lib/radar-calls-data";
import { todayPt } from "@/lib/session-date";
import { COMMIT_NOTE_MAX } from "@/components/commit/commit-target";

export const dynamic = "force-dynamic";

/**
 * User claims CRUD.
 *
 * GET returns the user's claims joined with their real outcomes:
 *  - EVERY claim, authored or adopted -> its OWN user_claim_outcomes row,
 *    keyed on the claim id and written by the attribution grader.
 * No outcome row means the claim renders open/not-graded; nothing is
 * fabricated and no verdict is ever borrowed.
 *
 * Adopted claims previously read through adopted_from_call_id to the
 * originating brief call's morning_brief_call_outcomes row. That was correct
 * when adopting was a bookmark, but an adopted claim now carries its own
 * forward window and is graded independently over it, so the brief's verdict
 * answers a different question. In the live data it was strictly wrong: an
 * adopted claim whose own window had not yet closed was rendering the brief
 * call's same-session verdict from weeks earlier.
 *
 * `adoptedOutcomes` is still returned, but as PROVENANCE ONLY: what the desk's
 * original call did, alongside (never instead of) the user's own result. See
 * src/lib/claim-outcome.ts, whose resolver cannot read it by construction.
 *
 * POST persists a proposal the user confirmed in the authoring flow.
 * user_claim is stored VERBATIM. Server re-validates gradeability the
 * same way the author route does.
 *
 * THE COMMIT NOTE. `commit_note` is ACCEPTED and NOT REQUIRED, exactly as
 * /api/radar/claims/adopt accepts it.
 *
 * The mobile composer will not unlock its control below twelve characters, and
 * that rule lives in the CLIENT, on purpose. Desktop /radar/calls is going to
 * adopt the same requirement later, and when it does it needs no second change
 * here: it sends the field this route already takes. A route that rejected a
 * short note would also break every caller that has no note to send, which
 * until now was every caller.
 *
 * WHAT THIS ROUTE DOES GUARANTEE is that the pair is coherent. `commit_note`
 * and `commit_note_at` are written in ONE object, from ONE decision, so a note
 * with no timestamp and a timestamp with no note are both unreachable. A client
 * cannot get that wrong because it is never asked to: it sends prose, and the
 * moment is stamped here.
 *
 * Degrades gracefully when tables are missing (migration sql/0012):
 * GET -> { claims: [], unavailable: true }.
 */

/**
 * The note as it will be stored, or null when there is nothing to store.
 *
 * Whitespace-only is nothing. An absent field is nothing. Both give back null,
 * and null is what makes the write below skip the timestamp too. Copied whole
 * from the adopt route, whose header explains every line of it; the trim is
 * load bearing twice, because the column's own CHECK is
 * length(btrim(commit_note)) > 0 and an untrimmed all-space note would hit a
 * constraint violation instead of storing NULL.
 */
function readCommitNote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, COMMIT_NOTE_MAX);
}

const CLAIM_TYPES = ["ticker", "sector", "index", "aggregate", "other"] as const;
const DIRECTIONS = ["bullish", "bearish", "neutral"] as const;
const MAX_CLAIM_CHARS = 400;
const MAX_WINDOW_DAYS = 90;

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  return error?.code === "42P01" || /does not exist/i.test(error?.message ?? "");
}

/**
 * THE READ MOVED AND THE RESPONSE DID NOT. Every select, every fold and every
 * degradation rule this handler used to carry inline now lives in
 * `src/lib/radar-calls-data.ts`, because Radar's Calls section on a phone is a
 * Server Component that reads the same claims directly instead of over HTTP.
 *
 * Two transports, one read. The four rules that matter (every claim reads its
 * OWN outcome, archived claims are excluded, newest outcome per claim wins, a
 * missing `claim_evidence` table degrades to no evidence) are stated once, in
 * that module, rather than once here and once again on the phone where one of
 * them would eventually stop being true.
 *
 * The three responses below are byte for byte what this route already answered:
 * a 401 with no session, the pre-migration `unavailable` shape, a 500 carrying
 * the database's own message, and otherwise the four keys the desk reads.
 */
export async function GET() {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const read = await loadRadarClaims(supabase, user.id);
  if (read.kind === "unavailable") {
    return NextResponse.json({ claims: [], outcomes: {}, adoptedOutcomes: {}, unavailable: true });
  }
  if (read.kind === "failed") {
    return NextResponse.json({ error: read.message }, { status: 500 });
  }
  return NextResponse.json({
    claims: read.claims,
    outcomes: read.outcomes,
    adoptedOutcomes: read.adoptedOutcomes,
    evidence: read.evidence,
  });
}

export async function POST(request: NextRequest) {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const userClaim = typeof body.user_claim === "string" ? body.user_claim.trim() : "";
  if (!userClaim || userClaim.length > MAX_CLAIM_CHARS) {
    return NextResponse.json({ error: "user_claim required (<=400 chars)" }, { status: 400 });
  }
  const claimType = CLAIM_TYPES.includes(body.claim_type as never)
    ? (body.claim_type as string)
    : "other";
  const direction = DIRECTIONS.includes(body.expected_direction as never)
    ? (body.expected_direction as string)
    : null;
  const isoDate = (v: unknown): string | null =>
    typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  const windowStart = isoDate(body.resolution_window_start);
  const windowEnd = isoDate(body.resolution_window_end);
  const targetSymbol =
    typeof body.target_symbol === "string" && body.target_symbol.trim()
      ? body.target_symbol.trim()
      : null;

  /* Accepted, never required. See the header.
     `body` is already typed Record<string, unknown>, so `body.commit_note` is
     `unknown` here without a widening: the adopt route has to declare
     `commit_note?: unknown` only because its body type names its fields. */
  const commitNote = readCommitNote(body.commit_note);

  // Server-side gradeability enforcement (never trust the client).
  // US market session date (Pacific), NOT UTC, so the window fallback and the
  // max-window check agree with what the user saw. One convention, shared via
  // src/lib/session-date.ts. See #543.
  const todayIso = todayPt();
  const priceable = ["ticker", "sector", "index"].includes(claimType);
  const windowOk =
    windowEnd !== null &&
    windowEnd > todayIso &&
    (new Date(windowEnd).getTime() - new Date(todayIso).getTime()) / 86400_000 <= MAX_WINDOW_DAYS;
  const gradeable =
    body.gradeable === true && priceable && Boolean(targetSymbol) && Boolean(direction) && windowOk;
  const gradeabilityNote =
    typeof body.gradeability_note === "string" && body.gradeability_note.trim()
      ? body.gradeability_note.trim()
      : gradeable
        ? null
        : "Not price-gradeable in v1; tracked as context only.";

  const conf =
    typeof body.confidence_in_reduction === "number" &&
    body.confidence_in_reduction >= 0 &&
    body.confidence_in_reduction <= 1
      ? body.confidence_in_reduction
      : null;

  const { data, error } = await supabase
    .from("user_claims")
    .insert({
      user_id: user.id,
      user_claim: userClaim,
      claim_type: claimType,
      target_symbol: claimType === "ticker" ? targetSymbol?.toUpperCase() : targetSymbol,
      expected_direction: direction,
      resolution_method: {
        method: gradeable ? "price_attribution" : "none",
        version: 1,
      },
      resolution_window_start: gradeable ? (windowStart ?? todayIso) : windowStart,
      resolution_window_end: windowEnd,
      evidence_entities: Array.isArray(body.evidence_entities)
        ? (body.evidence_entities as unknown[])
            .filter((e): e is string => typeof e === "string")
            .slice(0, 8)
        : [],
      gradeable,
      gradeability_note: gradeabilityNote,
      confidence_in_reduction: conf,
      status: "open",
      source: "authored",
      // ONE decision, TWO columns, one object. There is no ordering in which a
      // note lands without its timestamp or a timestamp without its note.
      commit_note: commitNote,
      commit_note_at: commitNote ? new Date().toISOString() : null,
    })
    .select("id, commit_note")
    .single();

  if (error) {
    if (isMissingTable(error)) {
      return NextResponse.json(
        { error: "Calls are not set up yet (migration pending)." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({
    id: data.id,
    gradeable,
    // Read back off the inserted row rather than echoed off the request, so a
    // caller that cares whether the reasoning is on the record is told by the
    // database and not by its own optimism.
    noteWritten: Boolean(data.commit_note),
  });
}

export async function PATCH(request: NextRequest) {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { id?: string; status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  // Users may only archive; verdict-bearing statuses belong to the grader.
  if (!body.id || body.status !== "archived") {
    return NextResponse.json({ error: "id and status='archived' required" }, { status: 400 });
  }
  const { error } = await supabase
    .from("user_claims")
    .update({ status: "archived" })
    .eq("id", body.id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

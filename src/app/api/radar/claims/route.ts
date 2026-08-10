import { NextRequest, NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { todayPt } from "@/lib/session-date";

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
 * Degrades gracefully when tables are missing (migration sql/0012):
 * GET -> { claims: [], unavailable: true }.
 */

const CLAIM_TYPES = ["ticker", "sector", "index", "aggregate", "other"] as const;
const DIRECTIONS = ["bullish", "bearish", "neutral"] as const;
const MAX_CLAIM_CHARS = 400;
const MAX_WINDOW_DAYS = 90;

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  return error?.code === "42P01" || /does not exist/i.test(error?.message ?? "");
}

export async function GET() {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: claims, error } = await supabase
    .from("user_claims")
    .select(
      "id, user_claim, claim_type, target_symbol, expected_direction, resolution_method, resolution_window_start, resolution_window_end, evidence_entities, gradeable, gradeability_note, status, source, adopted_from_call_id, created_at",
    )
    .eq("user_id", user.id)
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    if (isMissingTable(error)) {
      return NextResponse.json({ claims: [], outcomes: {}, adoptedOutcomes: {}, unavailable: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = claims ?? [];
  const outcomes: Record<string, unknown> = {};
  const adoptedOutcomes: Record<string, unknown> = {};

  // EVERY claim reads its own outcome. No source branch: an adopted claim is
  // graded over its own window exactly as an authored one is.
  const claimIds = rows.map((c) => c.id);
  if (claimIds.length) {
    const { data } = await supabase
      .from("user_claim_outcomes")
      .select(
        "claim_id, verdict, attribution, actual_pct_change, actual_direction, verdict_notes, graded_at, metadata",
      )
      .in("claim_id", claimIds)
      .order("graded_at", { ascending: false });
    // Latest row per claim (no unique constraint on claim_id).
    for (const o of data ?? []) {
      if (!(o.claim_id in outcomes)) outcomes[o.claim_id] = o;
    }
  }

  // Evidence ledger: supporting/challenging stories recorded against each open
  // claim while it waits (backend/grading/claim_evidence.py). Read-only here,
  // grouped by claim. Fail-open: before the migration (sql/0026) the table is
  // absent and this degrades to no evidence, never an error. It is never a
  // verdict; the surface renders it as plain counts, and the grader alone
  // resolves outcomes.
  const evidence: Record<string, unknown[]> = {};
  if (claimIds.length) {
    const { data, error: evErr } = await supabase
      .from("claim_evidence")
      .select("claim_id, stance, article_published_at, articles(title, url)")
      .in("claim_id", claimIds)
      .order("article_published_at", { ascending: false });
    if (!evErr) {
      for (const row of data ?? []) {
        const cid = (row as { claim_id: string }).claim_id;
        (evidence[cid] ??= []).push(row);
      }
    }
    // On a missing table (or any read error) evidence simply stays empty.
  }

  // Provenance only: what the desk's original call did. NEVER the adopted
  // claim's verdict. src/lib/claim-outcome.ts is the single resolver and it
  // takes no parameter through which this map could reach a verdict.
  const adoptedCallIds = rows
    .map((c) => c.adopted_from_call_id)
    .filter((id): id is string => Boolean(id));
  if (adoptedCallIds.length) {
    const { data } = await supabase
      .from("morning_brief_call_outcomes")
      .select(
        "call_id, verdict, attribution, actual_pct_change, actual_direction, verdict_notes, graded_at, metadata",
      )
      .in("call_id", adoptedCallIds)
      .order("graded_at", { ascending: false });
    for (const o of data ?? []) {
      if (!(o.call_id in adoptedOutcomes)) adoptedOutcomes[o.call_id] = o;
    }
  }

  return NextResponse.json({ claims: rows, outcomes, adoptedOutcomes, evidence });
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
    })
    .select("id")
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
  return NextResponse.json({ id: data.id, gradeable });
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

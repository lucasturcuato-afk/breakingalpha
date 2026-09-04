import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClaimOutcomeRow } from "./claim-outcome.ts";
import type { RawEvidenceRow } from "./claim-evidence.ts";
import type { CallOutcomeRow } from "./scored-object-map.ts";
import type { BriefCallRow, UserClaim } from "./radar-calls-model.ts";

/**
 * radar-calls-data - the read behind Radar's Calls section.
 *
 * TWO CALLERS, ONE READ. `src/app/api/radar/claims/route.ts` serves the desk,
 * which is a client component and fetches its claims over HTTP. Radar's Calls
 * section on a phone is a Server Component and reads them directly, because a
 * server read keeps `@supabase/supabase-js` out of that route's client bundle
 * and gets the screen its data before a byte is sent.
 *
 * Those are two transports and they must not become two reads. The claim rules
 * that matter are in the SELECT and in the fold underneath it: every claim
 * reads its OWN `user_claim_outcomes` row and never the originating brief
 * call's, archived claims are excluded, the newest outcome per claim wins, and
 * a missing `claim_evidence` table degrades to no evidence rather than to an
 * error. Copying that into a second file is how one of those four quietly stops
 * being true on one surface. So the route calls `loadRadarClaims` and so does
 * the phone, and the route's job shrinks to turning the result into a response.
 *
 * ADOPTED CLAIMS READ THEIR OWN OUTCOME. This is the rule a copy drops most
 * easily, so it is stated where the query is: adopted claims previously resolved
 * through `adopted_from_call_id` to the originating brief call's
 * `morning_brief_call_outcomes` row. That was the intended behaviour when
 * adopting was a bookmark. An adopted claim now carries its own forward window
 * and is graded independently over it, so the brief's verdict answers a
 * different question, and in live data it misreported: an adopted claim whose
 * own window had not closed rendered the brief call's same-session verdict from
 * weeks earlier.
 * `adoptedOutcomes` is still read, as PROVENANCE ONLY. `src/lib/claim-outcome.ts`
 * is the single resolver and it takes no parameter through which that map could
 * reach a verdict.
 *
 * THIS IS NOT THE DESK RECORD, and the distinction is load bearing because both
 * touch `morning_brief_call_outcomes`. The desk record is the desk's own graded
 * calls, bucketed and counted, and it has exactly one read path,
 * `src/lib/desk-record-query.ts`, which both of its entrances use. What is read
 * here is a reader's own claims plus the raw verdict on each brief call as it is
 * listed. Nothing here buckets, nothing here counts, and nothing here renders an
 * aggregate, so no figure produced by this module can disagree with a figure on
 * the record.
 *
 * READ ONLY. Selects only. Every write on this surface stays where it is, in the
 * route's own POST and PATCH and in the adopt route.
 */

/** Newest claims per reader. Matches the route's own limit. */
const CLAIM_LIMIT = 100;

/** How far back the brief-call list reaches, in days. Matches the desk. */
export const BRIEF_CALL_DAYS = 14;

/** How many brief calls the section lists. Matches the desk's own slice. */
export const BRIEF_CALL_LIMIT = 12;

/**
 * How many brief calls are READ. The desk reads 20 and lists 12; the extra six
 * exist because the read is ordered by `brief_date` and the list is grouped
 * afterwards. Kept identical so the two surfaces list the same twelve.
 */
const BRIEF_CALL_READ = 20;

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  return error?.code === "42P01" || /does not exist/i.test(error?.message ?? "");
}

export type RadarClaimsRead =
  | {
      kind: "ok";
      claims: UserClaim[];
      outcomes: Record<string, ClaimOutcomeRow>;
      /** Provenance only. Never a verdict for the claim that adopted it. */
      adoptedOutcomes: Record<string, CallOutcomeRow>;
      evidence: Record<string, RawEvidenceRow[]>;
    }
  /** The `user_claims` table is absent (migration sql/0012 pending). */
  | { kind: "unavailable" }
  /** The read failed. NEVER the same answer as an empty list. */
  | { kind: "failed"; message: string };

export async function loadRadarClaims(
  supabase: SupabaseClient,
  userId: string,
): Promise<RadarClaimsRead> {
  const { data: claims, error } = await supabase
    .from("user_claims")
    .select(
      "id, user_claim, claim_type, target_symbol, expected_direction, resolution_method, resolution_window_start, resolution_window_end, evidence_entities, gradeable, gradeability_note, status, source, adopted_from_call_id, created_at",
    )
    .eq("user_id", userId)
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(CLAIM_LIMIT);

  if (error) {
    if (isMissingTable(error)) return { kind: "unavailable" };
    return { kind: "failed", message: error.message };
  }

  const rows = (claims ?? []) as unknown as UserClaim[];
  const outcomes: Record<string, ClaimOutcomeRow> = {};
  const adoptedOutcomes: Record<string, CallOutcomeRow> = {};
  const evidence: Record<string, RawEvidenceRow[]> = {};

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
    for (const o of (data ?? []) as ClaimOutcomeRow[]) {
      const id = o.claim_id;
      if (id && !(id in outcomes)) outcomes[id] = o;
    }
  }

  // Evidence ledger: supporting and challenging stories recorded against each
  // open claim while it waits (backend/grading/claim_evidence.py). Read-only,
  // grouped by claim. Fail-open: before the migration (sql/0026) the table is
  // absent and this degrades to no evidence, never an error. It is never a
  // verdict; the surface renders it as plain counts, and the grader alone
  // resolves outcomes.
  if (claimIds.length) {
    const { data, error: evErr } = await supabase
      .from("claim_evidence")
      .select("claim_id, stance, article_published_at, articles(title, url)")
      .in("claim_id", claimIds)
      .order("article_published_at", { ascending: false });
    if (!evErr) {
      for (const row of data ?? []) {
        const cid = (row as { claim_id: string }).claim_id;
        (evidence[cid] ??= []).push(row as unknown as RawEvidenceRow);
      }
    }
    // On a missing table (or any read error) evidence simply stays empty.
  }

  // Provenance only: what the desk's original call did. NEVER the adopted
  // claim's verdict.
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
    for (const o of (data ?? []) as CallOutcomeRow[]) {
      if (!(o.call_id in adoptedOutcomes)) adoptedOutcomes[o.call_id] = o;
    }
  }

  return { kind: "ok", claims: rows, outcomes, adoptedOutcomes, evidence };
}

/**
 * The desk's own recent calls, their sectors and their verdicts.
 *
 * `outcomes` is NULL when the verdict read failed, and that is deliberately not
 * the same value as an empty map. An empty map means every call is still open;
 * null means the surface does not know, and the screen says so rather than
 * drawing twelve calls as though none of them had been graded yet. The desk
 * makes the same distinction and calls it "the least-claiming state".
 */
export interface BriefCallsRead {
  calls: BriefCallRow[];
  tickerSectors: Record<string, string>;
  outcomes: Map<string, CallOutcomeRow> | null;
  /** The `morning_brief_calls` read itself failed. Not an empty fortnight. */
  failed: boolean;
}

export async function loadBriefCalls(
  supabase: SupabaseClient,
  todayIso: string,
): Promise<BriefCallsRead> {
  const empty: BriefCallsRead = {
    calls: [],
    tickerSectors: {},
    outcomes: null,
    failed: true,
  };

  const since = new Date(Date.parse(`${todayIso}T00:00:00Z`) - BRIEF_CALL_DAYS * 86400_000)
    .toISOString()
    .slice(0, 10);

  const { data, error } = await supabase
    .from("morning_brief_calls")
    .select(
      "id, claim_text, claim_type, target_symbol, brief_date, resolve_on, created_at, confidence",
    )
    .gte("brief_date", since)
    .order("brief_date", { ascending: false })
    .limit(BRIEF_CALL_READ);
  if (error) return empty;

  const calls = ((data ?? []) as unknown as BriefCallRow[]).slice(0, BRIEF_CALL_LIMIT);
  if (calls.length === 0) {
    return { calls: [], tickerSectors: {}, outcomes: new Map(), failed: false };
  }

  const symbols = [
    ...new Set(
      calls
        .filter((c) => c.claim_type === "ticker")
        .map((c) => c.target_symbol)
        .filter((s): s is string => Boolean(s)),
    ),
  ];
  const tickerSectors: Record<string, string> = {};
  if (symbols.length) {
    const { data: companies } = await supabase
      .from("companies")
      .select("ticker, sector")
      .in("ticker", symbols);
    for (const row of (companies ?? []) as { ticker: string | null; sector: string | null }[]) {
      if (row.ticker && row.sector) tickerSectors[row.ticker] = row.sector;
    }
  }

  const { data: outcomeRows, error: outcomeError } = await supabase
    .from("morning_brief_call_outcomes")
    .select(
      "call_id, verdict, attribution, actual_pct_change, actual_direction, verdict_notes, graded_at, metadata",
    )
    .in(
      "call_id",
      calls.map((c) => c.id),
    );

  // A failed verdict read is not twelve open calls. Null says so.
  let outcomes: Map<string, CallOutcomeRow> | null = null;
  if (!outcomeError) {
    outcomes = new Map();
    for (const o of (outcomeRows ?? []) as CallOutcomeRow[]) {
      const prev = outcomes.get(o.call_id);
      if (!prev || (o.graded_at ?? "") > (prev.graded_at ?? "")) outcomes.set(o.call_id, o);
    }
  }

  return { calls, tickerSectors, outcomes, failed: false };
}

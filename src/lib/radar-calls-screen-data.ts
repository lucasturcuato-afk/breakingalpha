import type { SupabaseClient } from "@supabase/supabase-js";
import type { CallGroup, CallRow, CallsData } from "@/components/radar-mobile/calls-screen";
import { claimCardProps } from "./claim-card.ts";
import { resolveClaimOutcome } from "./claim-outcome.ts";
import { mobileOutcomeState } from "./mobile-outcome-state.ts";
import {
  BRIEF_CALL_DAYS,
  loadBriefCalls,
  loadRadarClaims,
} from "./radar-calls-data.ts";
import {
  briefResolutionSentence,
  groupBriefCalls,
  resolutionSentence,
  type BriefCallRow,
  type UserClaim,
} from "./radar-calls-model.ts";
import { scoredCallProps, type CallOutcomeRow } from "./scored-object-map.ts";
import { todayPt } from "./session-date.ts";

/**
 * radar-calls-screen-data - the map from the Calls read to the rows Radar's
 * Calls section draws on a phone.
 *
 * WHAT THIS FILE IS ALLOWED TO DECIDE: which row shape a claim takes, and in
 * what order. WHAT IT IS NOT ALLOWED TO DECIDE: what any verdict means. That
 * judgement is made by `claimCardProps` and `scoredCallProps`, the same two
 * pure functions the desk calls, and reaches a word through
 * `mobileOutcomeState`. Nothing here reads a `verdict` column, compares an
 * `attribution` value or picks a state from a row, which is what keeps the two
 * surfaces from grading the same call two different ways.
 *
 * NOTHING HERE COUNTS OR DIVIDES. The section renders a list, never a rate, and
 * the desk's own `RecordHero` percentage is barred from a mobile surface. The
 * only figures this module produces are list lengths, which the screen renders
 * as counts beside its section rules.
 *
 * IT IS NOT THE DESK RECORD. The desk record has one read path,
 * `src/lib/desk-record-query.ts`, and both of its entrances use it. This module
 * reads a reader's own claims and the desk's recent calls as individual rows
 * with individual verdicts. It buckets nothing and totals nothing, so no figure
 * it produces can disagree with a figure on the record.
 */

export interface CallsScreenRead {
  data: CallsData | null;
}

/** "CEG · AUG 27". Either half may be missing, and a lone separator is not drawn. */
function instrumentOf(symbol: string | null | undefined, iso: string | null | undefined): string | undefined {
  const parts = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  let stamp: string | null = null;
  if (parts) {
    const d = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
    if (!Number.isNaN(d.getTime())) {
      stamp = d
        .toLocaleDateString("en-US", { month: "short", day: "numeric" })
        .toLocaleUpperCase("en-US");
    }
  }
  const halves = [symbol, stamp].filter((x): x is string => Boolean(x));
  return halves.length > 0 ? halves.join(" · ") : undefined;
}

/**
 * The reader's own claim, as a row.
 *
 * `claimCardProps` decides the state and writes the verdict and attribution
 * lines. `resolutionSentence` says what an ungraded claim is watching for, and
 * it is the desk's own sentence rather than a second one: both surfaces import
 * it from `radar-calls-model.ts`.
 */
function claimRow(
  claim: UserClaim,
  outcome: CallOutcomeRow | null,
  todayIso: string,
  evidence: Record<string, { stance?: string | null }[]>,
): CallRow {
  const props = claimCardProps(
    {
      user_claim: claim.user_claim,
      claim_type: claim.claim_type,
      target_symbol: claim.target_symbol,
      created_at: claim.created_at,
      resolution_window_end: claim.resolution_window_end,
      gradeable: claim.gradeable,
      gradeability_note: claim.gradeability_note,
    },
    outcome,
    todayIso,
  );
  const state = mobileOutcomeState(props.state);
  return {
    id: claim.id,
    state,
    instrument: instrumentOf(claim.target_symbol, claim.created_at),
    /* Verbatim, as the reader wrote it. Never rewritten and never truncated:
       the row clamps in CSS, which is reversible, and a truncation here would
       not be. */
    claim: claim.user_claim,
    /* A settled claim says how it settled. An unsettled one says what it is
       watching for, which is the more useful line while there is no verdict
       and is the only line the desk draws under an open call. */
    result: props.attribution ?? props.verdict ?? resolutionSentence(claim),
    notGradedReason: props.notGradedReason,
    /* The evidence ledger is only meaningful while a claim waits. Under a
       verdict it is a list of stories that no longer decide anything. */
    evidence: state === "awaiting" || state === null ? (evidence[claim.id] ?? null) : null,
  } as CallRow;
}

function briefRow(call: BriefCallRow, outcome: CallOutcomeRow | null, todayIso: string): CallRow {
  const props = scoredCallProps(
    {
      claim_text: call.claim_text,
      target_symbol: call.target_symbol,
      claim_type: call.claim_type,
      confidence: call.confidence,
      created_at: call.created_at,
      brief_date: call.brief_date,
    },
    outcome,
    todayIso,
  );
  return {
    id: call.id,
    state: mobileOutcomeState(props.state),
    instrument: instrumentOf(call.target_symbol, call.brief_date),
    claim: call.claim_text,
    result: props.attribution ?? props.verdict ?? briefResolutionSentence(call),
    notGradedReason: props.notGradedReason,
  };
}

/**
 * Read both lists and reduce them to rows.
 *
 * `null` data means there is no reader to scope the claims to, which the screen
 * says and says only that. Every other failure is reported inside the shape, per
 * list, because one list failing says nothing about the other: a broken claims
 * table must not hide the desk's calls, and a broken brief read must not look
 * like a reader with no calls of their own.
 */
export async function loadCallsScreen(
  supabase: SupabaseClient,
  userId: string | null,
): Promise<CallsScreenRead> {
  if (!userId) return { data: null };

  const todayIso = todayPt();
  const [claims, brief] = await Promise.all([
    loadRadarClaims(supabase, userId),
    loadBriefCalls(supabase, todayIso),
  ]);

  const yours: CallRow[] = [];
  if (claims.kind === "ok") {
    for (const claim of claims.claims) {
      /* THE RESOLVER, NEVER A LOOKUP. `resolveClaimOutcome` takes no parameter
         through which a brief call's verdict could reach an adopted claim, by
         construction, and that is exactly the defect it exists to prevent: an
         adopted claim whose own window had not closed once rendered the brief
         call's same-session verdict from weeks earlier. */
      const outcome = resolveClaimOutcome(
        {
          id: claim.id,
          source: claim.source,
          adopted_from_call_id: claim.adopted_from_call_id,
          gradeable: claim.gradeable,
        },
        claims.outcomes,
      ) as CallOutcomeRow | null;
      yours.push(claimRow(claim, outcome, todayIso, claims.evidence));
    }
  }

  const groups: CallGroup[] = groupBriefCalls(brief.calls, brief.tickerSectors).map((g) => ({
    id: g.id,
    label: g.label,
    rows: g.calls.map((c) => briefRow(c, brief.outcomes?.get(c.id) ?? null, todayIso)),
  }));

  return {
    data: {
      yours,
      yoursUnavailable: claims.kind === "unavailable",
      yoursFailed: claims.kind === "failed",
      brief: groups,
      briefFailed: brief.failed,
      /* A failed verdict read is not a fortnight of open calls. The screen has
         to be able to tell the reader which of the two it is looking at. */
      briefVerdictsUnknown: !brief.failed && brief.outcomes === null,
      briefDays: BRIEF_CALL_DAYS,
    },
  };
}

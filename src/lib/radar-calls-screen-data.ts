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
/**
 * Whether this claim's evidence ledger can say anything at all, and against
 * what.
 *
 * MEASURED OFF THE PASS THAT WRITES THE ROWS, not guessed.
 * `backend/grading/claim_evidence.py` matches on exactly two claim types and
 * says so in its own header: a ticker claim matches articles whose companies[]
 * carries the symbol, a sector claim matches every article carrying the sector
 * label its ETF maps to, and "index / aggregate / other : NEVER matched".
 *
 * TWO THINGS FOLLOW, AND BOTH WERE DEFECTS ON THE SCREEN.
 *
 * A claim the pass never scans has no evidence and never will, so the empty
 * line under it, "No new evidence yet.", was not an absence being reported. It
 * was the surface asserting that nothing had been recorded when the truth is
 * that nothing was ever looked at. Those rows now carry no basis, and the block
 * is absent rather than saying something untrue.
 *
 * The other is the reason two rows in the same list can carry counts orders of
 * magnitude apart. A sector claim absorbs everything written about its whole
 * sector while a ticker claim gets what was written about one name, and nothing
 * on the screen said which of the two a reader was looking at. The basis is
 * carried so the line can name it.
 */
export function evidenceBasisOf(claim: UserClaim): CallRow["evidenceBasis"] {
  const symbol = claim.target_symbol?.trim();
  if (!symbol) return undefined;
  const kind = (claim.claim_type ?? "").trim().toLowerCase();
  if (kind === "ticker") return { kind: "ticker", symbol };
  if (kind === "sector") return { kind: "sector", symbol };
  return undefined;
}

/* Exported for `tests/unit/radar-calls-rows.test.ts`, which holds the three
   routes to "no grade" apart and holds the evidence gate. Both are decisions
   this file makes and neither is reachable from a component test. */
export function claimRow(
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
  const basis = evidenceBasisOf(claim);
  return {
    id: claim.id,
    state,
    /* PENDING IS NOT TERMINAL, and the screen collapsed the two into one word.
       `mobileOutcomeState` gives null for every not-graded row and the row then
       read "Not graded", whose own definition in `mobile-outcome-state.ts` is
       that "no credible grade exists and never will". On this branch that is
       false: the claim is gradeable, its window has closed, it satisfies every
       condition the grader scans for, and it is queued.

       Derived structurally, never by matching the reason string. The mapper
       reaches this state on exactly one path with no outcome row, and
       `claimCardProps` returns the mapper's props untouched whenever the claim
       is gradeable, so those two facts are the condition. The other routes to
       the same word are terminal and stay terminal: an outcome row carrying
       `ungradable`, a legacy row with no attribution, and a claim written
       `gradeable: false`. */
    notGradedPending: state === null && outcome === null && claim.gradeable,
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
    evidenceBasis: state === "awaiting" ? basis : undefined,
    /* THE LEDGER IS ONLY MEANINGFUL WHILE A CLAIM IS STILL OPEN, and the second
       half of that condition was doing damage.

       Under a verdict it is a list of stories that no longer decide anything,
       which is why the graded states were already excluded. The not-graded
       states were not, and there the block was worse than useless: it put two
       counts directly beneath a word that says no grade is coming, in the one
       place a reader is most likely to read a count as the missing verdict.

       So the ledger renders under an awaiting claim and nowhere else. `?? []`
       rather than `?? null` on that branch: an open claim the pass has scanned
       and matched nothing against is a real answer, and the honest empty line
       is the right thing to draw for it. The basis above is what decides
       whether the block appears at all. */
    evidence: state === "awaiting" && basis ? (evidence[claim.id] ?? []) : null,
  } as CallRow;
}

/**
 * A call the desk published, as a row.
 *
 * NO EVIDENCE FIELD, AND THERE CANNOT BE ONE. `claim_evidence` rows key on a
 * `user_claims` id, so a brief call cannot be the subject of one for any reader
 * on any day. The screen used to draw the block here anyway, which meant every
 * brief row carried the line "No new evidence yet." and could never carry
 * anything else. That is the same defect as the never-scanned claim above, one
 * list down: a sentence that reads as a finding and is a property of the schema.
 */
export function briefRow(call: BriefCallRow, outcome: CallOutcomeRow | null, todayIso: string): CallRow {
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
  const state = mobileOutcomeState(props.state);
  return {
    id: call.id,
    state,
    /* Same structural test as the reader's own claims: no outcome row and a
       closed window is a call the grader has not reached, not one it refused.
       A brief call has no gradeability flag to consult, so the mapper's single
       no-outcome path is the whole condition. */
    notGradedPending: state === null && outcome === null,
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

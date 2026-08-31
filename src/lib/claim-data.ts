/**
 * claim-data - the read path behind `/claim/[id]`.
 *
 * WHY THIS IS A NEW FILE AND NOT A REUSE. Nothing existing gives back this
 * shape. `loadLedger` builds a whole-timeline payload keyed off TODAY's brief,
 * so reusing it would make a bookmarked claim resolvable only while it is still
 * in today's brief, which a bookmark is not. `loadReview` reads from the
 * outcome side. `fetchDeskRecord` reads only calls that already carry an
 * outcome. `your-record.ts` performs no read at all. What IS reused is the
 * select in `loadDeskCalls` (ledger-data.ts:452-509), narrowed to one row, plus
 * `eyebrowFor` from that same module, so the eyebrow rule cannot drift between
 * the card and the screen it opens.
 *
 * WHAT IT READS
 *   morning_brief_calls          the one call, by id. Public read.
 *   user_claims                  whether this reader has already taken it onto
 *                                their own record. RLS-scoped, so the database
 *                                decides what the reader may see.
 *
 * IT NO LONGER READS morning_brief_call_outcomes, and that is a deletion rather
 * than an omission. The only thing the desk's verdict ever decided here was
 * whether to suppress the commit control, and it has no business deciding that:
 * a commit opens the READER's window today and grades on the reader's dates
 * (`src/lib/commit-legality.ts` sets out the whole argument). The screen draws
 * no verdict, so with the suppression gone there was nothing left for the row
 * to answer, and the round trip went with it.
 *
 * WHAT IT CANNOT READ, and therefore what the screen does not draw. The design
 * puts three more blocks on this screen and no column exists behind any of
 * them. `sql/0003_brief_self_grading.sql:14-24`, plus 0013 and 0014, define
 * morning_brief_calls as id, brief_id, brief_date, claim_text, claim_type,
 * target_symbol, expected_direction, confidence, created_at, is_lead and
 * resolve_on. `backend/synthesize.py:1497-1518` writes exactly those. So:
 *
 *   the desk's reading      two paragraphs in the design. NO COLUMN. The row
 *                           stores the falsifiable sentence and nothing behind
 *                           it.
 *   what would settle it    NO COLUMN. There is no stored statement of what
 *                           would falsify the claim.
 *   measured against        NO VALUE AT READ TIME, and deliberately not
 *                           derived. `backend/grading/price_attribution.py`
 *                           picks the benchmark when the grader runs. A
 *                           SECTOR_ETF_MAP exists on this side, but deriving
 *                           the pair here would make the screen PREDICT what
 *                           the grader will choose, from a fourth copy of a map
 *                           already duplicated three times. A prediction that
 *                           turns out otherwise on grading day is worse than a
 *                           row that never drew.
 *
 * It writes nothing, it makes no model call, and every field it cannot source
 * is null, which the screen draws as absence rather than as a stand-in.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { HORIZON_LABEL, daysBetween } from "./call-horizons";
import { commitLegality } from "./commit-legality";
import { eyebrowFor } from "./ledger-data";
import { todayPt } from "./session-date";

/**
 * The lifecycle the screen paints. One definition, consumed by both the loader
 * and the view, rather than a view copy that can drift from the loader's.
 *
 *   ready        the call was read
 *   loading      the read is in flight
 *   error        the read failed, which is never drawn as emptiness
 *   missing      the read succeeded and there is no such call
 *
 * IT USED TO CARRY A SIXTH, `ungradeable`, which was not a lifecycle at all: it
 * was one of the reasons a commitment is not on offer, wearing a read-state
 * costume. Every such reason now travels on the variant beside the other four,
 * where they can be compared. See ClaimVariant.
 */
export type ClaimStage = "ready" | "loading" | "error" | "missing";

/**
 * Whether this reader can act on this call, resolved HERE rather than on the
 * screen, the way `loadLedger` resolves the card's own variant.
 *
 *   open         not on the reader's record, and the call supports a commitment
 *   onLedger     already on the reader's record
 *   ungradeable  the call itself cannot be committed to, whatever the reader
 *                does. `commitReason` says which of the three things is missing
 *
 * IT IS THE CARD'S OWN THREE, exactly, and that is the repair. It used to carry
 * five: `graded`, `windowClosed` and `noWindow` sat here as extra reasons the
 * control was withheld, and all three are facts about the DESK's window that
 * never reach the row a commit writes. They were the source of the contradiction
 * this screen shipped, where /claim printed "there is nothing left to commit to"
 * over the same call id /ledger successfully committed to. See
 * `src/lib/commit-legality.ts` for the read paths that settle it.
 *
 * What survived the deletion is the honest half of the old design: a control
 * that vanishes with no sentence leaves a reader unable to tell a settled call
 * from a broken one. So the loader still names the reason and the screen still
 * states it. There are simply three real reasons instead of six, and the Ledger
 * now states the same three.
 */
export type ClaimVariant = "open" | "onLedger" | "ungradeable";

export interface ClaimSettlement {
  /**
   * The span of the DESK CALL's own window, already said. Null when the row
   * carries no resolve_on to measure to. See `windowSpan` below for the one
   * case that is not a day count.
   *
   * It is `daysBetween(brief_date, resolve_on)` and it is usually not 90. The
   * fixture this screen replaced wrote "90 days, fixed at entry", which was two
   * untruths in six words: the span is per call, and "entry" reads as the
   * READER's entry while the adopt route writes them a DIFFERENT window,
   * today to today plus their chosen horizon. The reader's own window belongs
   * on /entry, which is the screen that has it.
   */
  window: string | null;
  /** resolve_on, the date the desk's window closes. Null when it has none. */
  checked: string | null;
}

/**
 * `data` is required wherever it appears and has no default anywhere. The
 * screen draws loading or nothing when it is absent, never a sentence about
 * the reader.
 */
export interface ClaimData {
  /**
   * `morning_brief_calls.id`. The only id `/api/radar/claims/adopt` accepts,
   * which is why the commit sheet's target can be built from this shape at all.
   */
  callId: string;
  /** Sector or theme. Rendered as the eyebrow. */
  eyebrow: string;
  /** The falsifiable sentence. */
  claim: string;
  /**
   * The call's own resolve_on, raw ISO, and NEVER RENDERED. The commit sheet
   * preselects the call's span from it; `settlement.checked` beside it is
   * prose and cannot be read back into a date. Mirrors LedgerClaim.resolveOn
   * and the comment at ledger-data.ts:497-499.
   */
  resolveOn: string | null;
  /** The reader's session date, ISO. Passed to the sheet, never drawn. */
  sessionIso: string;
  settlement: ClaimSettlement;
  variant: ClaimVariant;
  /**
   * Why no commitment is on offer, or null when one is. Comes straight off
   * `commitLegality`, so it is the same sentence /ledger prints on the same
   * call rather than a second wording of the same fact.
   */
  commitReason: string | null;
}

export interface ClaimLoad {
  /** Null only when there is nothing to draw: a failed read, or no such call. */
  data: ClaimData | null;
  stage: ClaimStage;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * The id shape, checked BEFORE the query rather than after it.
 *
 * Two reasons, and the second is the load-bearing one. Postgres rejects a
 * malformed uuid with 22P02, so `/claim/demo` would come back as a failed read
 * and paint "We could not load this claim" over a string that was never an id.
 * And a round trip to establish that "demo" is not a uuid is a round trip
 * this file can decline to make.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The desk call's own window, said in days.
 *
 * A ZERO DAY SPAN IS A REAL WINDOW, not a missing one, and it is the common
 * case: the extractor's `session` bucket resolves a call at the close of the
 * day it was written. "0 days" alone reads as an absent value, so that one
 * count is said in the vocabulary the rest of the product already uses for it,
 * `HORIZON_LABEL.session`, imported rather than typed again.
 *
 * Null when there is nothing to measure, and null when the measurement is
 * negative: a resolve_on before the brief date is a broken row, not a window,
 * and the row is then simply absent from the screen.
 */
function windowSpan(days: number | null): string | null {
  if (days === null || days < 0) return null;
  if (days === 0) return HORIZON_LABEL.session;
  return `${days} ${days === 1 ? "day" : "days"}`;
}

interface BriefCallRow {
  id: string;
  claim_text: string | null;
  claim_type: string | null;
  target_symbol: string | null;
  /**
   * Selected because the commit rule reads it. `isAdoptGradeable` refuses a
   * call with no direction, so a screen that did not select this column could
   * only ever guess at the answer the adopt route would give.
   */
  expected_direction: string | null;
  brief_date: string | null;
  resolve_on: string | null;
}

/**
 * One desk call, for one reader.
 *
 * `[id]` IS a morning_brief_calls id, and the route settles that rather than
 * the string doing it. `src/app/entry/[id]/page.tsx` is the sibling route and
 * takes a user_claims id; both are uuids, so nothing in the text distinguishes
 * them and THIS FILE DOES NOT TRY. It looks the id up in morning_brief_calls,
 * and anything not there is missing. A user_claims id pasted into /claim
 * correctly lands on missing.
 *
 * `userId` null means nobody is signed in. The call still loads, because it is
 * public read, and the adoption question is simply not asked: a reader with no
 * session has no record for the call to be on. That matches the Ledger, whose
 * cards offer the same commit control to a signed-out reader.
 */
export async function loadClaim(
  supabase: SupabaseClient,
  userId: string | null,
  id: string,
): Promise<ClaimLoad> {
  const today = todayPt();

  if (!UUID.test(id.trim())) return { data: null, stage: "missing" };

  const { data, error } = await supabase
    .from("morning_brief_calls")
    .select("id, claim_text, claim_type, target_symbol, expected_direction, brief_date, resolve_on")
    .eq("id", id.trim())
    .maybeSingle();

  if (error) return { data: null, stage: "error" };

  const row = (data ?? null) as BriefCallRow | null;
  const claim = asText(row?.claim_text);
  // A row with no sentence is not a claim. The screen's missing copy is exactly
  // that: there is no claim at this address.
  if (!row || !claim) return { data: null, stage: "missing" };

  const resolveOn = asText(row.resolve_on)?.slice(0, 10) ?? null;
  const briefDate = asText(row.brief_date)?.slice(0, 10) ?? null;

  /* The reader's own record, and nothing else. The desk-outcome read that used
     to run beside this one is gone; see the header. */
  const adoptedRes = userId
    ? await supabase
        .from("user_claims")
        .select("id")
        .eq("user_id", userId)
        .eq("adopted_from_call_id", row.id)
        .limit(1)
    : null;

  /* A FAILED READ IS NOT A NO. A failed adoption read offers the control to
     someone who may already have taken this call, and the adopt route answers
     that safely: it finds the existing row and reports alreadyAdopted rather
     than writing a second one. Suppressing the control instead would tell a
     reader their claim is already on a record this read failed to look at. */
  const adopted =
    adoptedRes !== null &&
    !adoptedRes.error &&
    ((adoptedRes.data as unknown[] | null)?.length ?? 0) > 0;

  const span = briefDate && resolveOn ? daysBetween(briefDate, resolveOn) : null;

  /* THE shared question, asked of the shared function. `commitLegality` wraps
     `isAdoptGradeable`, which is the exact predicate /api/radar/claims/adopt
     evaluates before it decides what to write into `gradeable`, so this screen
     cannot promise a commitment the route would refuse or refuse one the route
     would accept. `loadDeskCalls` in ledger-data.ts asks the identical call.

     Being on the reader's own record still outranks it: that is true whatever
     the call's shape, and a reader who has already committed is not asking
     whether they may. */
  const legality = commitLegality(row, today);
  const variant: ClaimVariant = adopted ? "onLedger" : legality.canCommit ? "open" : "ungradeable";

  return {
    data: {
      callId: row.id,
      eyebrow: eyebrowFor(row),
      claim,
      resolveOn,
      sessionIso: today,
      settlement: {
        window: windowSpan(span),
        checked: resolveOn,
      },
      variant,
      commitReason: adopted ? null : legality.reason,
    },
    stage: "ready",
  };
}

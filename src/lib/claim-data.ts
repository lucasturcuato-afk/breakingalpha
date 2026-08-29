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
 *   morning_brief_call_outcomes  whether the desk has already graded it.
 *   user_claims                  whether this reader has already taken it onto
 *                                their own record. RLS-scoped, so the database
 *                                decides what the reader may see.
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
import { HORIZON_LABEL, daysBetween, isPriceableClaimType } from "./call-horizons";
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
 *   ungradeable  the call was read and no honest grader exists for its type,
 *                so nothing can be committed to
 */
export type ClaimStage = "ready" | "loading" | "error" | "missing" | "ungradeable";

/**
 * Whether this reader can act on this call, resolved HERE rather than on the
 * screen, the way `loadLedger` resolves the card's own variant.
 *
 *   open          not on the reader's record, inside its window, not graded
 *   onLedger      already on the reader's record
 *   graded        the desk has already checked it
 *   windowClosed  resolve_on is in the past
 *   noWindow      the row carries no resolve_on at all
 *
 * IT IS A SUPERSET OF THE CARD'S THREE, and the three extra values are the
 * whole point. A card lives in today's brief, where every call is open by
 * construction, so it never has to say why an action is absent. This screen is
 * reachable by a bookmark long after that, and a control that vanishes with no
 * sentence leaves a reader unable to tell a settled call from a broken one. So
 * the loader names the reason and the screen states it.
 *
 * `noWindow` is not an edge case. 305 of 416 rows, every call written on or
 * before 2026-07-22, carry no resolve_on: the column arrived in migration 0014
 * and nothing backfilled it. It is the COMMON case on any address older than
 * about five weeks, which is exactly what a bookmark is.
 */
export type ClaimVariant = "open" | "onLedger" | "graded" | "windowClosed" | "noWindow";

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
    .select("id, claim_text, claim_type, target_symbol, brief_date, resolve_on")
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

  const gradedPromise = supabase
    .from("morning_brief_call_outcomes")
    .select("call_id")
    .eq("call_id", row.id)
    .limit(1);

  const adoptedPromise = userId
    ? supabase
        .from("user_claims")
        .select("id")
        .eq("user_id", userId)
        .eq("adopted_from_call_id", row.id)
        .limit(1)
    : null;

  const [gradedRes, adoptedRes] = await Promise.all([gradedPromise, adoptedPromise]);

  /* A FAILED READ IS NOT A NO, and the tri-state is how that stays true. The
     desk having graded this call suppresses the action bar; a read that never
     came back has established neither that it did nor that it did not. It is
     treated as not suppressing, because the bar is not a statement about the
     desk's verdict: what the reader commits to is their OWN window, opened
     today, and that is unaffected by whether the desk has already closed its
     own. The closed-window test below still applies either way. */
  const graded: boolean | "unknown" = gradedRes.error
    ? "unknown"
    : ((gradedRes.data as unknown[] | null)?.length ?? 0) > 0;

  /* Same rule, other direction. A failed adoption read offers the control to
     someone who may already have taken this call, and the adopt route answers
     that safely: it finds the existing row and reports alreadyAdopted rather
     than writing a second one. Suppressing the control instead would tell a
     reader their claim is already on a record this read failed to look at. */
  const adopted =
    adoptedRes !== null &&
    !adoptedRes.error &&
    ((adoptedRes.data as unknown[] | null)?.length ?? 0) > 0;

  /* The window, in whole days, against the same session date every other
     surface uses. Negative is a window that has already passed. */
  const daysLeft = resolveOn ? daysBetween(today, resolveOn) : null;
  const windowOpen = daysLeft !== null && daysLeft >= 0;

  const span = briefDate && resolveOn ? daysBetween(briefDate, resolveOn) : null;

  /* Ordered, and the order is a ruling about which fact matters most. Being on
     the reader's own record outranks everything: it is true whatever the desk
     later did. A desk grade outranks a closed window because it is the stronger
     statement, and a graded call is past its window in almost every case
     anyway. An absent resolve_on is distinguished from a passed one, because
     "this call has no review date on record" and "this call's window has
     closed" are different sentences and only one of them is true. */
  const variant: ClaimVariant = adopted
    ? "onLedger"
    : graded === true
      ? "graded"
      : resolveOn === null
        ? "noWindow"
        : windowOpen
          ? "open"
          : "windowClosed";

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
    },
    // Gradeability is decided by claim type, the way the two desk surfaces
    // already decide it (BriefCallsSection.tsx:556, radar/calls/page.tsx:739).
    // A second rule here is how two surfaces start disagreeing about what the
    // grader can resolve.
    stage: isPriceableClaimType(row.claim_type) ? "ready" : "ungradeable",
  };
}

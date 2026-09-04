/**
 * commit-legality - the ONE answer to "can this reader commit to this call?".
 *
 * WHY THIS FILE EXISTS. Two screens offered the same commitment on the same
 * five call ids and disagreed about whether it was possible. `/claim/[id]`
 * printed "The desk has already checked this call, so there is nothing left to
 * commit to." `/ledger` drew "Track this call" on the identical row, and
 * pressing it wrote a real `user_claims` row with a live forward window and
 * `gradeable: true`. One screen called the action impossible while the other
 * performed it successfully, because each computed the condition itself.
 *
 * WHICH ONE WAS RIGHT: /ledger. The commitment is legal, and the read paths
 * settle it rather than taste:
 *
 *   1. `/api/radar/claims/adopt` opens the reader's window at `todayPt()` and
 *      runs it to their own horizon. It never reads the desk's `resolve_on`
 *      and never reads `morning_brief_call_outcomes`. What it writes into
 *      `gradeable` is `isAdoptGradeable(call, todayIso, windowEnd)`, and that
 *      predicate reads three fields off the call plus the READER's window.
 *   2. `backend/grading/grade_user_claims.py` scans on `gradeable = true`,
 *      `resolution_method.method = 'price_attribution'`, `status = 'open'` and
 *      `resolution_window_end <= today`, and its header states that
 *      `adopted_from_call_id` "is provenance only and is never read here". The
 *      row resolves over the reader's window on the reader's dates.
 *   3. `claim-data.ts` already said so in prose, at the tri-state comment above
 *      its own variant chain: "what the reader commits to is their OWN window,
 *      opened today, and that is unaffected by whether the desk has already
 *      closed its own." The chain below that sentence then suppressed the
 *      control on exactly that ground.
 *
 * The sentence /claim/[id] printed rested on a stale citation. Its action-bar
 * comment claimed "the adopt route silently writes `gradeable: false`
 * (adopt/route.ts:141-149)". At those lines the route computes gradeability
 * from `isAdoptGradeable`; the hardcoded false it was describing was removed
 * when adopt started writing a real forward window, and the justification
 * outlived the behaviour it justified.
 *
 * SO BOTH SCREENS WERE WRONG, in opposite directions, and only one direction
 * was visible. /claim/[id] refused a legal commitment on three grounds that are
 * facts about the DESK's window (graded, windowClosed, noWindow) and say
 * nothing about the reader's. /ledger offered the commitment on every call in
 * today's brief including ones the adopt route would write `gradeable: false`
 * for: no target symbol, no expected direction, or a claim type the price
 * grader cannot resolve. Those rows are the real defect the missing gate was
 * supposed to prevent. They are written `status: 'open'`, the grader's
 * `.eq("gradeable", True)` drops them before the loop, and nothing ever closes
 * them.
 *
 * THE RULE HERE IS NOT A FOURTH COPY. `canCommit` IS `isAdoptGradeable`, the
 * same exported function the adopt route calls before it decides what to write,
 * evaluated against the window the commit would actually open. A screen and the
 * row it produces cannot disagree, because the screen asks the writer's own
 * question.
 *
 * Pure: no fetch, no React, no DOM, no clock. `todayIso` is passed in so a
 * server render and a client render cannot land on different days.
 */

import {
  addCalendarDays,
  adoptWindowDays,
  adoptWindowForCall,
  adoptWindowPhrase,
  isAdoptGradeable,
  type AdoptGradeableCall,
} from "./call-horizons";

/**
 * Why a commitment is not on offer. Every value is a fact about the CALL, never
 * about the desk's window or the desk's verdict, because neither of those
 * reaches the row a commit writes.
 */
export type CommitBlock = "noSymbol" | "noDirection" | "notPriceable";

/**
 * One sentence per block, in the register the product already uses: state the
 * missing thing, name no outcome, and never imply the reader was too late.
 *
 * `notPriceable` is the existing `UNGRADEABLE_REASON` string verbatim. It is
 * defined here and re-exported from `components/calls/TrackCallControl` rather
 * than the other way round, so a lib may read it without importing a client
 * component.
 */
export const COMMIT_BLOCK_REASON: Record<CommitBlock, string> = {
  noSymbol: "This call names no instrument to measure against, so there is nothing to commit to.",
  noDirection: "This call names no direction to measure, so there is nothing to commit to.",
  notPriceable: "No honest grader for this claim type yet, so there is nothing to commit to.",
};

/**
 * What a caller must read off `morning_brief_calls` to ask the question.
 *
 * `resolve_on` is the call's own settlement date. It does NOT gate the answer.
 * It is read only to reproduce the window the commit sheet preselects, so the
 * predicate is evaluated against the window that would actually be written
 * rather than an invented one.
 *
 * `brief_date` USED TO SIT HERE AND IS GONE, because reading it was the defect
 * `commitWindow` below records. It is still a column and still selected by
 * every caller; it is simply not an input to this question.
 */
export interface CommitCandidate extends AdoptGradeableCall {
  resolve_on?: unknown;
}

export type CommitLegality =
  | { canCommit: true; block: null; reason: null }
  | { canCommit: false; block: CommitBlock; reason: string };

function isoDate(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 10) : null;
}

/** The reader's own window, as a screen may state it before the press. */
export interface CommitWindow {
  /** Calendar days from today. The number the sheet shows. */
  days: number;
  /** The date that window closes, ISO. */
  endIso: string;
  /** The same span in the product's own words, e.g. "resolves in about a week". */
  phrase: string;
}

/**
 * The window a commit on this call would open, today to the sheet's preselect.
 *
 * THE ANCHOR IS THE READER'S SESSION DATE AND IT USED TO BE THE CALL'S BRIEF
 * DATE, which is a correction rather than a tidy-up. `commit-sheet.tsx:126`
 * calls `adoptWindowForCall(target.sessionIso, target.resolveOn)`. This called
 * it with `(brief_date, resolve_on)`, which is the DESK's span, and the comment
 * that used to sit here claimed the two agreed. On a live call they usually do,
 * because the desk's span and the span remaining both come out of the same
 * bucket. On a call whose `resolve_on` has already passed they do not and
 * cannot: `daysBetween(today, resolve_on)` is negative, so the sheet falls
 * through `adoptWindowForCall`'s guards to `DEFAULT_ADOPT_HORIZON` and offers a
 * week, while this function was still reading the desk's own span off the row.
 * A same-session desk call read that way yielded a zero-day window here against
 * the seven-day one a press actually writes.
 *
 * `canCommit` was unaffected in both directions, which is why it survived this
 * long: `adoptWindowForCall` only ever yields a span in 0..90 whichever anchor
 * it is given, and `resolveAdoptWindow` clamps every override into the same
 * range, so `isAdoptGradeable`'s two window tests (`windowEnd < today`,
 * `span > 90`) are unreachable from any prospective adopt on either. The answer
 * depends on the three call fields alone, which is what makes it stable enough
 * for a screen to print. `tests/unit/commit-legality-parity.test.ts` asserts
 * that over every horizon.
 *
 * What it DID affect is anything that prints the number, which is why the
 * mismatch mattered the moment `/claim/[id]` began stating the reader's window
 * beside the desk's. A screen naming a span that is not the span a press writes
 * is a worse failure than naming none.
 */
export function commitWindow(call: CommitCandidate, todayIso: string): CommitWindow {
  const window = adoptWindowForCall(todayIso, isoDate(call.resolve_on));
  const days = adoptWindowDays(window);
  return { days, endIso: addCalendarDays(todayIso, days), phrase: adoptWindowPhrase(window) };
}

/** The close of that window. The half `commitLegality` needs. */
export function commitWindowEnd(call: CommitCandidate, todayIso: string): string {
  return commitWindow(call, todayIso).endIso;
}

/**
 * Reached only when `isAdoptGradeable` has already answered false, and it walks
 * that function's field tests in the same order so the sentence names the first
 * thing actually missing. The window tests cannot be the cause; see
 * `commitWindowEnd`.
 */
function blockFor(call: CommitCandidate): CommitBlock {
  const symbol = typeof call.target_symbol === "string" ? call.target_symbol.trim() : "";
  if (!symbol) return "noSymbol";
  if (!call.expected_direction) return "noDirection";
  return "notPriceable";
}

/**
 * Whether this call can be committed to, and if not, the sentence to print.
 *
 * Whether the reader has ALREADY committed is a different question with a
 * different answer shape, and it is not asked here: it needs a per-reader read
 * of `user_claims`, which each loader does for itself. This function answers
 * only whether the call itself supports a commitment at all.
 */
export function commitLegality(call: CommitCandidate, todayIso: string): CommitLegality {
  if (isAdoptGradeable(call, todayIso, commitWindowEnd(call, todayIso))) {
    return { canCommit: true, block: null, reason: null };
  }
  const block = blockFor(call);
  return { canCommit: false, block, reason: COMMIT_BLOCK_REASON[block] };
}

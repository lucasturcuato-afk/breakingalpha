/**
 * What Radar does not draw, and why, as rendered copy rather than as comments.
 *
 * THE RULING THIS FILE EXISTS FOR. Omitted tiers must state their reason on
 * screen. A reason is not an empty state, and the two are different in kind:
 *
 *   an EMPTY STATE says something about the READER ("you follow nothing yet").
 *                  It needs a read behind it, and `watch/page.tsx` records what
 *                  happened the last time three of them shipped without one.
 *   a REASON       says something about the PRODUCT ("this is not drawn here,
 *                  and here is why"). It needs no read at all, which is why
 *                  this file is a constant and not a loader.
 *
 * So none of the strings below is conditional on anything `watch-data.ts`
 * hands back, and none of them is about the reader. Every one names an absent
 * thing and the measured reason it is absent.
 *
 * `tests/unit/watch-omissions.test.ts` carries both halves of that: it fails on a
 * second-person sentence, on an empty reason, and on the vocabulary the
 * compliance rules close off. The rule is enforced rather than remembered.
 *
 * Where the reasons used to live: in this module's neighbours, as comments, and
 * in PR bodies. A recon measured the whole rendered body of `/watch` at 390 by
 * 844 signed in and found no string about any omitted thing anywhere on it. The
 * screen applied the standard rigorously to omissions INSIDE a tier it drew and
 * not at all to the tiers it left out.
 */

export interface WatchOmission {
  /** Stable key. Not rendered. */
  id: string;
  /** What is absent, as a noun phrase. Never an instruction, never a person. */
  absent: string;
  /** Why, as a statement about the product. One or two sentences. */
  reason: string;
}

/**
 * Four things, in the order the screen would have drawn them.
 *
 * TRACKED VIEWS IS FIRST, and it is the one that changed. The reason recorded
 * against it for two releases was that `TrackedView.headline` had no source,
 * because `user_claims` carries no article foreign key. That reason was WRONG
 * and it is corrected here and in the four comments that repeated it.
 * `sql/0012_radar_user_claims.sql:10-11` says outright that `user_claim`
 * "is the headline"; `/radar/calls` renders it as one; and `review-data.ts`
 * already reads exactly these columns for exactly this purpose. The premise
 * stands only if the headline has to be an ARTICLE headline, and the tier is
 * tracked VIEWS, so a view is a claim rather than a story.
 *
 * The real reason is one table down, and it is about the ROWS rather than the
 * columns. Measured against production on 2026-08-29, whole table, all three
 * accounts, read only:
 *
 *   user_claims                                     18 rows
 *   carrying a commit_note                           1 row
 *   with expected_direction NULL                     0 rows
 *   with resolution_window_end NULL                  0 rows
 *
 * A tracked view is defined, in three separate places in this repo, as a claim
 * with no direction and no window on it, and therefore one that is never
 * graded: `fixture.ts`'s own type doc, the prototype's invariant meta line, and
 * the prototype's detail copy "no direction, no window, so it is never graded".
 * Not one row in `user_claims` is that. The single row that carries a note is
 * bullish over a two-day window, and the grader has already resolved it.
 *
 * So the mapping works and the row set does not. Drawing that row under this
 * tier's rule would print an invariant saying it has no direction beside a
 * direction, under a masthead saying nothing on this screen is ever graded,
 * about a claim that was. It would also put the reader's own record under the
 * Radar pole, which ruling 17 puts one pole over, under Ledger. Three separate
 * false notes, so the tier stays absent and says why.
 *
 * THE OWNER RULED ON THIS TIER on 2026-08-29, and that ruling is why the string
 * below records a DECISION rather than the row count. Verbatim: "A
 * directionless, windowless claim is not writable. Nothing grades it, and
 * 'tracked as context' is already a destination with no exit. I am not adding a
 * second path into that state until it has an honest treatment. Ship the
 * omission reasons without it."
 *
 * The string first shipped here read "None has been written that way", which
 * describes a gap and reads as an invitation to close it: write one claim that
 * way and the tier appears. That is the opposite of the ruling. Three parts of
 * it are worth keeping, because the next person will otherwise re-open this:
 *
 *   1. NOTHING GRADES A DIRECTIONLESS, WINDOWLESS CLAIM. The counts above are
 *      not a gap that fills over time. The tier's own predicate selects zero
 *      rows, and `api/radar/claims/adopt/route.ts:162` cannot produce one: it
 *      stamps a direction and a window on every claim it takes.
 *   2. "TRACKED AS CONTEXT" IS ALREADY A DESTINATION WITH NO EXIT. A claim
 *      written `gradeable: false` with `resolution_method.method = "none"` is
 *      dropped by `is_price_gradeable` at
 *      `backend/grading/grade_user_claims.py:103-107`, which gates on the flag
 *      before it ever reads the method, and the drop happens at `:138`, before
 *      the grading loop runs. The row is therefore never resolved, never
 *      written to `user_claim_outcomes`, and its `status` is never moved off
 *      "open". Two of the 18 rows sit in that state now, and one has been open
 *      since its window closed on 2026-07-03. That was PR #713's second defect,
 *      and that PR fixed it on the READ side only: the screen now says the row is
 *      not graded, and the row is still never closed.
 *   3. THE CONDITION FOR REVERSAL is an honest treatment of that state, not
 *      more rows. Writing one directionless, windowless claim would not open
 *      this tier. Giving "tracked as context" an exit would.
 *
 * So the copy states the rule rather than the row set, and it must keep doing
 * so. The full reasoning is recorded in DECISIONS.md as ruling 21; the screen
 * gets one sentence of it.
 */
/* THE COPY IS SHORT ON PURPOSE, and the first draft was not. Rendered at 390
   the long version ran fourteen lines, which on an account whose tiers are both
   empty is more of the screen than the tiers themselves: a wall of apology, and
   the one shape the ruling rules out alongside empty wells. Each reason is now
   one sentence, two at most, and the argument behind it lives in the header
   above rather than in front of a reader who did not ask for it.

   EIGHT RENDERED LINES AT 390, and that figure is a budget rather than an
   observation. Measured in the paragraph itself: two lines fit a reason of
   about 109 characters and three begin at about 113, so the ruling reword
   above was cut to the budget rather than allowed to spend a ninth line.
   Re-measure before lengthening any of the four. */
export const WATCH_OMISSIONS: WatchOmission[] = [
  {
    id: "tracked-views",
    absent: "Tracked views",
    reason:
      "The tier draws claims with no direction and no window. Nothing grades or closes one, so none is ever written.",
  },
  {
    id: "lead-story",
    absent: "A lead story",
    reason: "Nothing ranks one name above another, so no entry is promoted above the rest.",
  },
  {
    id: "theme-names",
    absent: "Theme names over following",
    reason: "The labels come from a later pass and are absent until it runs.",
  },
  {
    id: "staleness",
    absent: "A staleness line",
    reason:
      "Nothing records when the last pass ran, so this screen never dates the readings above.",
  },
];

/**
 * The mobile Dashboard's entrance ladder.
 *
 * ── WHY THIS IS A FUNCTION AND NOT A TABLE ───────────────────────────
 *
 * What shipped was a constant map: every rung had a delay written next to its
 * name, 0/60/120/.../540, a uniform 60ms grid across ten rungs. That is a
 * correct description of a screen where every rung renders, and this screen is
 * not one. Sections whose source is null are not drawn at all, deliberately
 * (see the screen's header comment), so the reader's own data decides which
 * rungs exist.
 *
 * MEASURED, not reasoned. On a live account four of the twelve rise elements
 * were absent (`context`, the "waiting for you" rule, the waiting card and
 * "your record"), and the browser applied the authored delays to the eight
 * that remained:
 *
 *   declared  0 / 60 / 60 / 120 / 180 / 240 / 300 / 300 / 360 / 420 / 480 / 540
 *   rendered  0 / 60 / 60 /  -  / 180 / 240 /  -  /  -  / 360 /  -  / 480 / 540
 *   gaps           60    0        120    60         120        120    60
 *
 * Observed matched declared within 5ms on every rung that existed, so nothing
 * was wrong with the stylesheet's arithmetic. The stylesheet was describing a
 * ladder that does not render. And the hole count is a property of the
 * reader's data: a second account with "your record" present measured two
 * holes rather than three. One authored table, two cadences.
 *
 * Tuning the constants cannot fix that, because there is no set of constants
 * that is even for every subset. The index has to be computed over the rungs
 * that exist on THIS render, which is what `ladderDelays` does.
 *
 * ── WHY NOT CSS ──────────────────────────────────────────────────────
 *
 * The rise elements are all direct children of the same `.dots` column, so
 * `nth-child` reaches them. It still cannot express this. `nth-child` counts
 * every sibling, and the column also holds explainers, bucket grids, tail
 * links and the disclaimer, none of which rise; CSS has no "nth of class". Nor
 * could it collapse the two pairs below that deliberately share one rung. So
 * the index is computed here and the stylesheet keeps only the curve, the
 * duration and the gate.
 *
 * ── THE INTERVAL IS NOT SETTLED, AND IS NOT SETTLED HERE ─────────────
 *
 * 60ms was justified from the prototype's design note, "staggered by about
 * sixty milliseconds down the landing". That sentence is written about the
 * LANDING. The dashboard mock's own measured modal gap is 40ms, as is the
 * desktop's. So 60 has no support in the artefact it cites, and 40 may be the
 * right number. It is left at 60 on purpose: the cadence a reader actually got
 * was reader-dependent, and choosing between 60 and 40 was meaningless while
 * that was true. Even first, then the interval, as its own decision.
 */

/**
 * The authored reading order of the rungs, top to bottom down the column.
 *
 * This list IS the documentation of what animates when. A reader who wants to
 * know the order reads it here and nowhere else; a reader who wants to know
 * the delays reads this order and multiplies by `STAGGER_MS`, skipping
 * whatever their data left out.
 *
 * Two rungs carry two elements each, which is drawn intent rather than an
 * accident of the list:
 *   `greeting`  the eyebrow and the headline, one block in the prototype
 *   `waiting`   the section rule and the card beneath it
 * They share a rung, so they share a delay and a gap of zero between them.
 * `marketHead` and `marketBand` are the opposite case: two rungs under one
 * condition, so the band always follows its own heading by one step.
 */
export const LADDER_ORDER = [
  "dateRule",
  "greeting",
  "context",
  "marketHead",
  "marketBand",
  "waiting",
  "brief",
  "yourRecord",
  "deskRecord",
  "stories",
] as const;

export type LadderRung = (typeof LADDER_ORDER)[number];

/** The interval between two consecutive rungs that both render. */
export const STAGGER_MS = 60;

/**
 * The four proportion bars under the desk's record, as offsets from the rung
 * that introduces them rather than as absolute delays.
 *
 * They were absolute, [500, 540, 580, 620], which was `deskRecord` at 480 plus
 * these four numbers. Absolute could not survive a ladder whose length depends
 * on the render: on an account with three sections missing the desk's rule
 * lands at 240 and bars pinned at 500 would sweep a third of a second after
 * the heading they belong to, or on a longer ladder, before it.
 *
 * The 40ms internal cadence is deliberately NOT the rise ladder's interval.
 * `barSweepIn` is a horizontal scaleX across the bar's own width, not a 22px
 * vertical rise, so the front-loaded-curve argument that set the rise ladder's
 * amplitude does not apply to it: there is no small displacement to lose. Four
 * bars reading as one gesture is the drawn intent.
 */
export const BAR_OFFSETS = [20, 60, 100, 140] as const;

/**
 * The delay for every rung, given which rungs render.
 *
 * Walks the authored order once and advances the step only past rungs that
 * exist, so the delays handed to the rendered elements are always
 * 0, S, 2S, 3S, ... with no holes, whatever subset arrived.
 *
 * Absent rungs are still assigned a number, equal to the next rendered rung's.
 * Nothing reads it, by construction, and returning a total record keeps the
 * call sites free of non-null assertions.
 */
export function ladderDelays(rendered: Record<LadderRung, boolean>): Record<LadderRung, number> {
  const delays = {} as Record<LadderRung, number>;
  let step = 0;
  for (const rung of LADDER_ORDER) {
    delays[rung] = step * STAGGER_MS;
    if (rendered[rung]) step += 1;
  }
  return delays;
}

/**
 * The delays actually applied, in order, for a given subset. The gap list this
 * produces is the acceptance test for the ladder, and the reason it is
 * exported is so that test can be run without a browser.
 */
export function renderedDelays(rendered: Record<LadderRung, boolean>): number[] {
  const delays = ladderDelays(rendered);
  return LADDER_ORDER.filter((rung) => rendered[rung]).map((rung) => delays[rung]);
}

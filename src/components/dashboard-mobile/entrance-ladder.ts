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
 * ── WHY THE INTERVAL IS 40 AND THE AMPLITUDE IS 22 ───────────────────
 *
 * These two look like one decision and they are two, settled separately and on
 * different evidence.
 *
 * THE INTERVAL IS 40ms, from both references. The desktop measures a 40ms
 * modal gap and so does the prototype's own `dash` flag. The 60 that shipped
 * was cited from the design note's "staggered by about sixty milliseconds down
 * the landing", and that sentence is written about the LANDING, not this
 * screen. It had no support in the artefact it cited.
 *
 * That number was only worth choosing once the mechanism above existed. While
 * the delays were a fixed table, the cadence a reader actually got depended on
 * which sections their data produced, so "60 or 40" was a question about a
 * number nobody was receiving. The ladder is even at every rung count now, so
 * the interval means something.
 *
 * THE AMPLITUDE IS 22px, and that one overrides both references, which measure
 * 12. It is a deliberate deviation, not drift: `cubic-bezier(0.16, 1, 0.3, 1)`
 * is heavily front-loaded, so on a 12px rise the measured displacement per
 * 60Hz frame falls under 1px after 63ms, and 12px is about 3mm on a phone. It
 * reads as a fade rather than an arrival. Desktop and the prototype were drawn
 * for larger canvases. Do not "correct" this back to 12; it is recorded as a
 * ruling.
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
export const STAGGER_MS = 40;

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
 * THE INTERNAL 40ms IS NOT THE RUNG INTERVAL AND DOES NOT TRACK IT. It happens
 * to equal it now and that is a coincidence of this round's ruling, not a link.
 * `barSweepIn` is a horizontal scaleX across the bar's own width, not a 22px
 * vertical rise, so the front-loaded-curve argument that set the rise ladder's
 * amplitude has nothing to bite on here: there is no small displacement to
 * lose. Four bars reading as one gesture is the drawn intent, and it stays 40
 * whatever the rungs do.
 *
 * THE LEAD-IN WAS RE-DERIVED WHEN THE RUNGS WENT 60 -> 40, NOT RESCALED, and
 * the proportional answer is exactly why. Scaling 20ms by 40/60 gives 13.3ms,
 * which is BELOW one 60Hz frame: the first bar would be committed on the same
 * frame as the heading it hangs off, and the lead-in would stop existing as a
 * beat rather than becoming a shorter one. So the number is derived from two
 * bounds instead:
 *
 *   lower  >= 16.7ms, one frame at 60Hz, or it is not a separate beat
 *   upper  <  one rung interval, or the group reads as belonging to the rung
 *            BELOW the desk's record rather than to the desk's record itself
 *
 * At 60ms rungs the window was [16.7, 60); at 40ms it is [16.7, 40). 20ms is
 * the only round value comfortably inside both, and at a 40ms grid it is
 * exactly half a rung, so the four sweeps now fill the half-beats of the rung
 * cadence instead of drifting against it as they did under 60. The numbers are
 * unchanged and the reason for them is not.
 *
 * The group lands after its own heading on every ladder length, which is the
 * property that matters and which the unit test asserts over all 64 subsets.
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

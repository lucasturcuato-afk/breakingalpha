/**
 * What Radar does not draw and says so anyway, as rendered copy rather than as
 * comments. One entry, and the reason it is the only one.
 *
 * THE RULING THIS FILE NOW CARRIES, given 2026-08-29, verbatim: "The app must
 * never assert something false, but it does not have to enumerate everything
 * absent. Four stacked 'not shown here' explanations on Radar read as a product
 * apologizing for itself. Omit silently unless absence would mislead."
 *
 * THAT NARROWS AN EARLIER RULING RATHER THAN OVERTURNING ONE. PR #731 shipped
 * this file and the `OmittedNotes` block under the rule that every omitted tier
 * must say on screen why it is absent. That ruling held then and is not a
 * mistake to be undone; it is a rule whose scope has been cut. The honesty half
 * is untouched. The enumeration half is now conditional on a test:
 *
 *   WOULD A READER BE MISLED BY THE ABSENCE OF THE NOTE?
 *
 * Not "is the note true" - all four were true. Absence misleads when it changes
 * what a RENDERED figure means, when a reader would reasonably infer the
 * product checked something it did not check, or when another surface draws the
 * thing so its absence here reads as "you have none" rather than "we do not
 * draw this". Otherwise the reader has no way to know the thing was ever meant
 * to be there, nothing on screen becomes wrong without it, and the answer is
 * silence. That is the ordinary case.
 *
 * WHY THIS FILE STILL EXISTS RATHER THAN BEING DELETED. Applied per entry,
 * three of the four failed the test and one passed it:
 *
 *   TRACKED VIEWS        dropped. Nothing on `/watch` names a third tier, no
 *                        figure counts claims, and the masthead's "your
 *                        watchlist and what you follow" describes exactly what
 *                        is drawn. A reader cannot know the tier was ever meant
 *                        to be there, and no rendered line becomes wrong
 *                        without the note. The measurement that kept the tier
 *                        out is unchanged and lives in `fixture.ts` and
 *                        `src/lib/watch-data.ts`; what is dropped is the
 *                        on-screen sentence, not the finding.
 *
 *   THE PINNED HERO      dropped. Every entry renders as the same card, so
 *                        nothing on screen implies a rank that is then missing.
 *
 *   THEME NAMES          dropped. Cluster labels are null until a lazy pass
 *                        names them, and `ThemeCluster` already draws no
 *                        heading when there is none. The rows read as a list
 *                        because they are one. No figure counts themes.
 *
 *   STALENESS            KEPT, and it is the one that would mislead. The screen
 *                        renders dated claims off an undated store: "No news
 *                        today", "N with news / M quiet", "This week's
 *                        coverage", "an empty week, not a failed load". Every
 *                        one of those is read out of stored article rows
 *                        (`watch-data.ts` filters on `published_at`), and
 *                        nothing records when the pass that fills them last
 *                        ran. Without the note "No news today" reads as "we
 *                        looked today and found nothing", which is a check the
 *                        product did not make. That is the second failure mode
 *                        above, squarely, and it is the same shape as the two
 *                        corrections this screen already protects: the
 *                        per-entry read fault, which withdraws names from the
 *                        quiet count, and `FollowingTail`, which withdraws its
 *                        own "empty week, not a failed load" claim when a
 *                        follow could not be checked. Those correct WHO is in
 *                        the set. This one corrects WHEN it was measured.
 *
 * SO THE MECHANISM IS NOT AN EMPTY SHELL. `WATCH_OMISSIONS` carries exactly one
 * entry, `OmittedNotes` draws it, and the list must not become a place nobody
 * reads. If the last entry ever goes, delete this file and that block with it.
 *
 * THE DISTINCTION THAT SURVIVES INTACT, because it decides the copy:
 *
 *   an EMPTY STATE says something about the READER ("you follow nothing yet").
 *                  It needs a read behind it, and `watch/page.tsx` records what
 *                  happened the last time three of them shipped without one.
 *   a REASON       says something about the PRODUCT ("this is not drawn here,
 *                  and here is why"). It needs no read, which is why this file
 *                  is a constant and not a loader.
 *
 * ONE PLACE THE OLD "NEEDS NO READ" DOCTRINE NO LONGER HOLDS, and it is worth
 * naming so it is not restored as a tidy-up. `OmittedNotes` used to render
 * unconditionally in every stage on the grounds that a reason is true in every
 * stage. That is false for the entry that survived: at `?stage=stale` the
 * screen draws "Last checked <time>", and a foot note saying it "never dates
 * the readings above" would be contradicted by a line directly above it. The
 * block is gated on that one stage in `watch-screen.tsx`. The gate is not a
 * read about the reader; it is the screen declining to state an absence in the
 * one stage where the thing is present.
 *
 * `tests/unit/watch-omissions.test.ts` pins all of it: the surviving set
 * exactly, the three dropped ids by name so restoring one is red, the
 * product-not-reader register, and the render.
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
 * The one absence whose silence would mislead.
 *
 * TWO RENDERED LINES AT 390, down from eight, and that figure is a budget
 * rather than an observation. Measured in the paragraph itself: two lines fit a
 * reason of about 109 characters and three begin at about 113. Re-measure
 * before lengthening it, and re-measure the trailing void with it, because the
 * foot of this screen is the seam that starts with a structural floor already
 * under it.
 */
export const WATCH_OMISSIONS: WatchOmission[] = [
  {
    id: "staleness",
    absent: "A staleness line",
    reason:
      "Nothing records when the last pass ran, so this screen never dates the readings above.",
  },
];

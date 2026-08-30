/**
 * What Radar does not draw and says so anyway. Currently: nothing.
 *
 * THE RULING THIS FILE EXISTS FOR, given 2026-08-29, verbatim: "The app must
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
 * ALL FOUR WENT. Three of them failed that test outright:
 *
 *   TRACKED VIEWS        Nothing on `/watch` names a third tier, no figure
 *                        counts claims, and the masthead's "your watchlist and
 *                        what you follow" describes exactly what is drawn. A
 *                        reader cannot know the tier was ever meant to be
 *                        there. The measurement that keeps it out is unchanged
 *                        and lives in `fixture.ts` and `src/lib/watch-data.ts`;
 *                        what went is the on-screen sentence, not the finding.
 *
 *   THE PINNED HERO      Every entry renders as the same card, so nothing on
 *                        screen implies a rank that is then missing.
 *
 *   THEME NAMES          Cluster labels are null until a lazy pass names them,
 *                        and `ThemeCluster` already draws no heading when there
 *                        is none. The rows read as a list because they are one.
 *                        No figure counts themes.
 *
 * THE FOURTH IS THE INTERESTING ONE AND IT WENT FOR A DIFFERENT REASON.
 * Staleness passed the misleading test and was kept for one round, on the
 * argument that `/watch` renders dated claims off an undated store: "No news
 * today", the with-news and quiet counts, "This week's coverage", "an empty
 * week, not a failed load". All are read out of stored article rows
 * (`watch-data.ts` filters on `published_at`) and nothing records when a given
 * desk's rows were last refreshed. That argument is still true. It is just not
 * an argument for a note.
 *
 * THE OWNER'S RULING, 2026-08-29, is that the note is A CAPTION ON A WRONG
 * SENTENCE. `/watch` says "No news today" off a store it cannot date, and issue
 * issue #748 measured that `watchlist_articles` currently holds zero rows published
 * or fetched within 24h DB-wide, so every entry on every desk renders quiet
 * right now. A footnote explaining that nothing is dated does not make "No news
 * today" true. It apologises for it in smaller type, which is the shape the
 * ruling above rules out, and it lets a wrong sentence keep shipping because
 * something downstairs technically withdrew it.
 *
 * THE FIX IS issue #748, NOT COPY. Making the `stale` branch reachable lets the
 * screen say when it last checked instead of asserting a check it did not make.
 * A screen that dates its readings needs no note about not dating them.
 *
 * DO NOT RESTORE THE NOTE ON THE OLD REASONING. "But the quiet line is undated"
 * is the argument that kept it, and it is correct and is not sufficient. The
 * only thing that would put a staleness note back here is a case where the
 * screen states the date it checked AND still omits something a reader would be
 * misled by.
 *
 * THE DISTINCTION THAT SURVIVES INTACT, because it decides any future copy:
 *
 *   an EMPTY STATE says something about the READER ("you follow nothing yet").
 *                  It needs a read behind it, and `watch/page.tsx` records what
 *                  happened the last time three of them shipped without one.
 *   a REASON       says something about the PRODUCT ("this is not drawn here,
 *                  and here is why"). It needs no read, which is why this file
 *                  is a constant and not a loader.
 *
 * `tests/unit/watch-omissions.test.ts` pins the empty list, the four dropped ids
 * by name so restoring one is red, and the mechanism below: that `OmittedNotes`
 * still exists, is still in the tree, still iterates this constant, and draws
 * nothing while it is empty.
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
 * EMPTY, AND KEPT EMPTY RATHER THAN DELETED. This is the owner's instruction
 * and not an oversight: "keep the mechanism with an empty array and a comment
 * saying why, rather than deleting it. issue #748 will make the stale branch
 * reachable and something will need to render."
 *
 * So the type, the constant, `OmittedNotes` and its render site all stay. What
 * is gone is the copy, all four entries of it, for the reasons in the header
 * above. `OmittedNotes` returns null while this is empty, so the screen renders
 * no container, no rule and no heading, and the foot of the scroll is the last
 * tier. That is verified in the DOM rather than by reading the component.
 *
 * WHEN issue #748 LANDS, the screen will date its own readings and the question of
 * what belongs here reopens. Anything added must clear the test in the header:
 * would a reader be misled by its absence, and is the note a correction rather
 * than a caption on a sentence that should have been fixed instead.
 *
 * An entry added here renders immediately and unconditionally in every stage
 * but `stale`. Read the gate in `watch-screen.tsx` before adding one; it was
 * written for a note that no longer exists and it has to be re-decided against
 * whatever replaces it.
 */
export const WATCH_OMISSIONS: WatchOmission[] = [];

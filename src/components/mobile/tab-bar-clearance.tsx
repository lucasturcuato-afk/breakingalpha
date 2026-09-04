/**
 * Clearance for the tab bar, as an element rather than as padding on the
 * shell's scroll container.
 *
 * WHY IT EXISTS AT ALL. `app-shell.tsx:178` already puts
 * `pb-[calc(var(--mobile-tabbar-height)+env(safe-area-inset-bottom))]` on
 * `#main-content`. Chrome drops a scroll container's bottom padding once its
 * content overflows, so on a full-bleed route the last thing a screen draws
 * ends level with the bar's top edge and the bar is painted over it. Measured
 * on `/watch` at 390 before this element existed: the last line bottomed out at
 * 820px against a bar top of 785px, so 35px of it sat behind the bar. A
 * synthetic reproduction of the container DOES honour the padding, which is why
 * this is measured on the real page rather than reasoned about.
 *
 * ONE DEFINITION, AND THAT IS THE POINT OF THIS MODULE. The same declaration
 * was written FOUR times, character for character, in four screens that had
 * each rediscovered the same Chrome behaviour and each written its own
 * measurement down:
 *
 *   watch/watch-screen.tsx        a module-local `TabBarClearance`
 *   radar-mobile/calls-screen.tsx a second module-local `TabBarClearance`
 *   app/deal-flow/page.tsx        a bare div, "at the end of the scroll the
 *                                 last Generate a deal memo control sat 20px
 *                                 UNDER the tab bar"
 *   prepared-record/record-screen a bare div, "scrollHeight 7346 against a root
 *                                 of 7346, so the padding contributed nothing"
 *
 * A fifth screen, `claim/claim-screen.tsx`, then shipped with none of it: at
 * 320 on a graded call the action bar ran 770 to 824 against a bar top of 785,
 * `#main-content` could not scroll at all, and `document.elementFromPoint` at
 * the centre of "Track this call" answered with the tab bar's Radar pole. Four
 * implementations of one rule is how the fifth screen came to have none, and
 * this repo has now paid for that shape six times (PR 713, PR 721, PR 738,
 * `slugToCompanyName`, PR 736's three back controls, and this).
 *
 * `tests/unit/tab-bar-clearance.test.ts` asserts this file is the only place in
 * `src/` the expression is written, so a sixth copy fails before it is a
 * screen. Two NEAR copies are deliberately left alone and named there:
 * `desk-record-screen.tsx` adds 24px of gap on top of the clearance, and
 * `dashboard-screen.tsx` passes a `0px` fallback to `env()`. Neither is this
 * declaration, and folding either one in would change what it draws.
 *
 * IT IS THE LAST CHILD OF THE SCREEN ROOT, never of the body, and never of an
 * inner scroller. On a sparse screen whose body is centred, a clearance placed
 * outside the root would let the centring push content under the bar; placed
 * here, the centred region is the space between the masthead and this block.
 *
 * IT IS COUNTABLE AT RUNTIME. `data-tabbar-clearance` is not decoration: this
 * element has no fill and no ink, so a screen that renders it twice is 59px
 * shorter of content and looks completely normal, and a screen that renders it
 * none is only visibly broken at one width in one theme on one state. The
 * attribute is what lets a geometry harness say "exactly one, on this route" in
 * a rendered page rather than in a grep, which matters because both existing
 * call sites sit in branches: each screen writes it twice in source and renders
 * it once.
 *
 * `aria-hidden`, empty, and `flex: none`, so a screen reader walks straight
 * from the last block to the end of the screen, and no flex parent can shrink
 * the clearance away to make its own content fit.
 */
export function TabBarClearance() {
  return (
    <div
      aria-hidden="true"
      data-tabbar-clearance=""
      style={{
        flex: "none",
        height: "calc(var(--mobile-tabbar-height) + env(safe-area-inset-bottom))",
      }}
    />
  );
}

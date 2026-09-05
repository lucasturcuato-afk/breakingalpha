/**
 * Where a company back control goes when nothing of OURS is behind the page.
 *
 * ONE DEFINITION, FOR THE SAME REASON `ASK_POLE_HREF` HAS ONE. Three controls
 * need this route now: the mobile hit branch's `BackHeader`, the mobile miss
 * branch's, and `CompanyBackLink` on the desk. PR 736 is the recorded cost of
 * three copies of a route: the pole moved, the three literals did not, and
 * tsc, lint and the build were all green while readers landed on the wrong
 * screen. This module imports nothing, so a test can read the value without
 * mounting a client component.
 *
 * WHY `/company` AND NOT THE MOBILE TWIN. `desk-redirect-map.ts` already owns
 * the desk-to-phone mapping and lists `"/company": "/ask"`, so a phone reader
 * who falls through to this href is carried to the phone directory by the one
 * component that knows about twins. Spelling `/ask` here instead would put a
 * second copy of that mapping at a call site, which is the same failure one
 * field over: the twin table could move and this literal would not.
 *
 * IT IS NOT A GUESS AT WHERE THE READER CAME FROM. It is the one screen that
 * can answer "then where IS this company", which is why the miss branch chose
 * it first and why both surfaces use it now.
 */
export const COMPANY_BACK_HREF = "/company";

/**
 * The visible word on a history-aware back control.
 *
 * `screen-chrome.tsx` settled this and the reason is written there: a control
 * that steps back says "Back", and a control that promises a destination names
 * the destination. All three company controls step back, so all three say
 * "Back", and a screen reader announcing "Back, link" is then describing what
 * the control does rather than a pole it does not always deliver.
 */
export const COMPANY_BACK_LABEL = "Back";

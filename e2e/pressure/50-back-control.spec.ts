/**
 * The back control, and the ejection it exists to prevent.
 *
 * WHY THIS IS ITS OWN FILE AND NOT A LINE IN THE WALK. The walk taps every
 * control on every screen and it CANNOT SEE THIS ONE. It enters every screen
 * with `page.goto`, which means the referrer is always the harness and never a
 * foreign origin, so the branch that used to eject a reader out of Signalera is
 * unreachable from it. A hundred and fifty findings and the highest-consequence
 * fix on the trunk went untested. The only way in is a real second origin and a
 * real click, which is what this builds.
 *
 * WHAT THE FIX DOES. A reader arriving from Slack, iMessage, email or a search
 * result used to tap the back chevron and land back on the referring site:
 * ejected from the app entirely. `history.length > 1` was the wrong question,
 * because it counts entries that existed before we did.
 * `navigation.currentEntry.index` is the right one: `navigation.entries()` is
 * by spec the SAME-ORIGIN CONTIGUOUS slice of the tab's history, so a foreign
 * referrer is not in it, and index 0 means "we are the first page of ours".
 *
 * WHAT IS ASSERTED, AND WHAT IS NOT. Destination, never label. All three
 * controls read "Back" rather than the pole's name, and the pole is Browse now
 * and was Ask before, so a label assertion would be testing the wrong thing
 * twice over. The destination is `ASK_POLE_HREF`, `/ask`.
 *
 * The failure this cares about is EJECTION. Every case asserts the reader is
 * still on the app's origin afterwards; which in-app branch was taken is
 * measured and recorded rather than assumed, because two of the four cases have
 * a defensible answer either way.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { Server } from "http";
import {
  installGuards,
  launch,
  phoneContext,
  readEntry,
  coldGoto,
  AUTH_STATE,
  BASE,
} from "./lib/harness";
import { BACK_SCREENS, FOREIGN_ORIGIN, startForeignOrigin, stopForeignOrigin } from "./lib/foreign-origin";
import { finding, note } from "./lib/report";

/** The Browse pole's route. The back control's `href`, and the only acceptable
    fall-through destination. */
const BROWSE_POLE_ROUTE = "/ask";

function backControl(page: Page) {
  /* By destination, not by the visible word. Scoped to `main`, because the tab
     bar's Browse pole carries the SAME href and would be a different control
     answering for this one. `:visible` because the desktop sidebar is in the
     DOM at 390 with `display:none` on it, and a hidden link is not a control a
     reader can tap. */
  return page.locator(`main a[href="${BROWSE_POLE_ROUTE}"]:visible`).first();
}

/** An in-app link a reader can actually see. The desktop sidebar carries the
    same hrefs and is display:none at 390; matching it means clicking nothing
    for fifteen seconds. */
function visibleAppLink(page: Page, path: string) {
  return page.locator(`main a[href="${path}"]:visible`).first();
}

async function where(page: Page): Promise<{ origin: string; pathname: string }> {
  return page.evaluate(() => ({ origin: location.origin, pathname: location.pathname }));
}

/**
 * Which branch the control took, read off the Navigation API rather than
 * guessed from the destination.
 *
 * `router.back()` moves WITHIN our slice: the index falls and the entry count
 * does not. The anchor navigating PUSHES: the entry count grows. On the three
 * screens under test both can land on `/ask`, so the destination alone cannot
 * tell them apart and the report would be unable to say which half of the fix
 * ran.
 */
function classify(before: { navIndex?: number; navEntries?: number }, after: { navIndex?: number; navEntries?: number }): string {
  if (before.navEntries === undefined || after.navEntries === undefined) return "unknown (no Navigation API)";
  if (after.navEntries > before.navEntries) return "anchor-navigated (entries grew)";
  if ((after.navIndex ?? 0) < (before.navIndex ?? 0)) return "stepped-back (index fell, entries unchanged)";
  if (after.navEntries === before.navEntries && after.navIndex === before.navIndex) return "no movement";
  return `other (index ${before.navIndex}->${after.navIndex}, entries ${before.navEntries}->${after.navEntries})`;
}

/** Arrive the way a reader arrives: foreign page, real anchor, real click. */
async function arriveFromForeign(page: Page, appPath: string) {
  const foreign = await page.evaluate(() => location.href);
  expect(foreign.startsWith(FOREIGN_ORIGIN), "must start on the foreign origin").toBe(true);
  await Promise.all([
    page.waitForURL((u) => u.toString().startsWith(BASE + appPath), { timeout: 25_000 }),
    page.click(`a[href="${BASE}${appPath}"]`),
  ]);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(600);
}

async function tapBack(page: Page) {
  const control = backControl(page);
  await expect(control, "a back control must be on this screen").toBeVisible({ timeout: 10_000 });
  const before = await readEntry(page);
  const fromPath = (await where(page)).pathname;
  await control.click();
  /* Wait for the move rather than guessing at it. `/ask` reads the company
     directory on the server, so a client-side navigation into it can take well
     over a second, and a fixed timeout reports "the control did nothing" on a
     control that was mid-navigation. If it genuinely does not move, that is
     recorded as no movement rather than hidden by a longer sleep. */
  await page
    .waitForFunction((p) => window.location.pathname !== p, fromPath, { timeout: 8_000 })
    .catch(() => {});
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(400);
  const after = await readEntry(page);
  return { before, after, branch: classify(before, after) };
}

/** The one thing that is never acceptable. */
function assertStillInTheApp(w: { origin: string; pathname: string }, screen: string, caseName: string) {
  if (w.origin !== BASE) {
    finding({
      severity: "critical",
      rule: "back-control-ejects-the-reader",
      screen,
      pass: "static",
      title: `${caseName}: tapping back left Signalera and landed on ${w.origin}${w.pathname}`,
      evidence: `Arrived from ${FOREIGN_ORIGIN} by a real anchor click. The back control must never return the reader to the referring site.`,
      basis: "measured",
    });
  }
  expect(w.origin, `${caseName} on ${screen}: the reader was ejected to ${w.origin}`).toBe(BASE);
}

let server: Server;

test.beforeAll(async () => {
  server = await startForeignOrigin(BASE);
});
test.afterAll(async () => {
  await stopForeignOrigin(server);
});

for (const screen of BACK_SCREENS) {
  test(`back control on ${screen.path}: A foreign referrer, no in-app hop`, async () => {
    const browser = await launch();
    const ctx = await phoneContext(browser, "light", AUTH_STATE);
    await installGuards(ctx, [FOREIGN_ORIGIN]);
    const page = await ctx.newPage();

    /* A fresh page, so the foreign origin is the tab's FIRST entry and the
       arrival at the app is genuinely one hop from somewhere else. */
    await coldGoto(page, FOREIGN_ORIGIN + "/");
    await arriveFromForeign(page, screen.path);

    const onArrival = await readEntry(page);
    note(
      "back-control-entry",
      screen.path,
      `case A, arrived from ${FOREIGN_ORIGIN}: history.length ${onArrival.historyLength}, navigation index ${onArrival.navIndex}, entries ${onArrival.navEntries}`,
      "measured",
    );
    expect(onArrival.navIndex, "a foreign referrer must not be in our slice").toBe(0);
    expect(onArrival.historyLength, "the tab does carry the foreign entry").toBeGreaterThan(1);

    const r = await tapBack(page);
    const w = await where(page);
    note("back-control-result", screen.path, `case A: ${r.branch}, landed ${w.origin}${w.pathname}`, "measured");
    assertStillInTheApp(w, screen.path, "case A (foreign referrer, no in-app hop)");
    expect(w.pathname, "with nothing of ours behind, the anchor must carry the reader to the Browse pole").toBe(
      BROWSE_POLE_ROUTE,
    );

    await ctx.close();
    await browser.close();
  });

  test(`back control on ${screen.path}: B foreign referrer, one in-app hop`, async () => {
    const browser = await launch();
    const ctx = await phoneContext(browser, "light", AUTH_STATE);
    await installGuards(ctx, [FOREIGN_ORIGIN]);
    const page = await ctx.newPage();

    /* Foreign -> the Browse pole -> the screen. Two of ours in the slice, the
       screen at index 1, and a foreign page underneath both that the control
       must never reach. */
    await coldGoto(page, FOREIGN_ORIGIN + "/");
    await arriveFromForeign(page, BROWSE_POLE_ROUTE);
    await Promise.all([
      page.waitForURL((u) => u.toString().includes(screen.path), { timeout: 25_000 }),
      visibleAppLink(page, screen.path).click(),
    ]);
    await page.waitForTimeout(800);

    const onScreen = await readEntry(page);
    note(
      "back-control-entry",
      screen.path,
      `case B, foreign -> ${BROWSE_POLE_ROUTE} -> ${screen.path}: history.length ${onScreen.historyLength}, navigation index ${onScreen.navIndex}, entries ${onScreen.navEntries}`,
      "measured",
    );
    expect(onScreen.navIndex, "one in-app hop puts a page of ours behind this one").toBe(1);

    const r = await tapBack(page);
    const w = await where(page);
    note("back-control-result", screen.path, `case B: ${r.branch}, landed ${w.origin}${w.pathname}`, "measured");
    assertStillInTheApp(w, screen.path, "case B (one in-app hop)");
    expect(w.pathname, "it must step back to the in-app page the reader came from").toBe(BROWSE_POLE_ROUTE);

    /* NEVER PAST THE ENTRY POINT, proved on the slice itself rather than on a
       count. Stepping back does NOT shrink `navigation.entries()`: the forward
       entry stays in it, so the slice is two long with the reader at index 0.
       The count is therefore not the proof. The URLs are: the referrer is
       absent from the slice, so there is no entry behind this one for a further
       back to reach, and `shouldStepBack` reads index 0 and falls through to
       the anchor. */
    const atEntry = await readEntry(page);
    note(
      "back-control-entry",
      screen.path,
      `case B, after stepping back: navigation index ${atEntry.navIndex}, entries ${atEntry.navEntries} ${JSON.stringify(atEntry.navUrls)}, history.length ${atEntry.historyLength} (the foreign page is in the TAB and not in OUR slice)`,
      "measured",
    );
    expect(atEntry.navIndex, "back to the first page of ours").toBe(0);
    expect(
      (atEntry.navUrls ?? []).some((u) => u.startsWith(FOREIGN_ORIGIN)),
      "the foreign referrer must not be anywhere in our slice",
    ).toBe(false);
    expect(atEntry.historyLength, "the tab still carries the foreign entry; our slice does not").toBeGreaterThan(
      atEntry.navEntries ?? 0,
    );

    await ctx.close();
    await browser.close();
  });

  test(`back control on ${screen.path}: C genuine cold entry`, async () => {
    const browser = await launch();
    const ctx = await phoneContext(browser, "light", AUTH_STATE);
    await installGuards(ctx, [FOREIGN_ORIGIN]);
    const page = await ctx.newPage();

    const cold = await coldGoto(page, screen.path);
    note(
      "back-control-entry",
      screen.path,
      `case C, cold entry: history.length ${cold.historyLength}, navigation index ${cold.navIndex}, entries ${cold.navEntries}`,
      "measured",
    );
    expect(cold.historyLength, "a genuine cold entry is one tab history entry").toBe(1);
    expect(cold.navIndex).toBe(0);

    const r = await tapBack(page);
    const w = await where(page);
    note("back-control-result", screen.path, `case C: ${r.branch}, landed ${w.origin}${w.pathname}`, "measured");
    assertStillInTheApp(w, screen.path, "case C (cold entry)");
    expect(w.pathname, "the anchor carries a cold reader to the Browse pole").toBe(BROWSE_POLE_ROUTE);

    await ctx.close();
    await browser.close();
  });

  test(`back control on ${screen.path}: D hard reload mid-session`, async () => {
    const browser = await launch();
    const ctx = await phoneContext(browser, "light", AUTH_STATE);
    await installGuards(ctx, [FOREIGN_ORIGIN]);
    const page = await ctx.newPage();

    await coldGoto(page, FOREIGN_ORIGIN + "/");
    await arriveFromForeign(page, BROWSE_POLE_ROUTE);
    await Promise.all([
      page.waitForURL((u) => u.toString().includes(screen.path), { timeout: 25_000 }),
      visibleAppLink(page, screen.path).click(),
    ]);
    await page.waitForTimeout(600);

    const beforeReload = await readEntry(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
    const afterReload = await readEntry(page);
    note(
      "back-control-entry",
      screen.path,
      `case D, hard reload mid-session: index ${beforeReload.navIndex} -> ${afterReload.navIndex}, entries ${beforeReload.navEntries} -> ${afterReload.navEntries}`,
      "measured",
    );

    const r = await tapBack(page);
    const w = await where(page);
    /* EITHER BRANCH IS CORRECT HERE and the report says which one ran. If the
       reload cleared our slice the control falls through to its href, which is
       the designed degradation: a lateral jump, never an ejection. If the slice
       survived, it steps back. Only leaving the app is a failure. */
    note(
      "back-control-result",
      screen.path,
      `case D: ${r.branch}, landed ${w.origin}${w.pathname}. Falling through to the anchor after a reload is the designed degradation, not a defect; only an ejection would be.`,
      "measured",
    );
    assertStillInTheApp(w, screen.path, "case D (hard reload mid-session)");
    /* Both acceptable branches land on the same path here, because the page
       behind this one IS the Browse pole. `w.pathname` therefore cannot tell
       them apart and `r.branch` is what does; asserting on the path alone
       would be an assertion that cannot fail. What must not happen is the
       control sitting there doing nothing. */
    expect([BROWSE_POLE_ROUTE, screen.path], "the reader must stay in the app").toContain(w.pathname);
    expect(r.branch, "the control must actually move the reader").not.toBe("no movement");

    await ctx.close();
    await browser.close();
  });
}

/**
 * The commit note on the three desk adopt surfaces.
 *
 * THE GATE IS GONE AND THIS SUITE IS WHAT PROVES IT STAYS GONE.
 * `decisions/commit-note-optional-when-adopting.md` reverses the half of
 * DECISIONS.md ruling 11 that put a note inside what adopting a call means:
 * required when authoring through Compose, optional when adopting a call the
 * desk already reasoned about. PR 761 shipped it on the phone commit sheet;
 * the desk followed on 2026-09-02.
 *
 * The field STAYS on every surface and asks. Nothing is withheld behind it.
 * This suite asserts both halves of that at 1440x900, because a suite that
 * only asserted the button was live would pass on a surface that had deleted
 * the field. The file keeps its name so the history is followable.
 *
 * NOTHING HERE MAY WRITE A ROW. `/api/radar/claims/adopt` is intercepted in
 * the FIXTURE below, before the first `page.goto` of every test in this file,
 * so a per-test override that someone forgets to add cannot reach the real
 * route. The default answer is a refusal, not a success: a test that means to
 * exercise the happy path has to say so by installing its own handler ON TOP,
 * which is a visible line in the test rather than a silent default.
 *
 * WHAT IS EXPECTED TO FAIL, AND WHY IT IS WRITTEN THAT WAY. One thing on this
 * branch is known-broken and is declared with `test.fail()`, which passes
 * while it is broken and turns RED the day it is fixed. That is the point: the
 * suite tells you when to delete the declaration.
 *
 * `test.fail()` is used ONLY where the test fails on an ASSERTION. Playwright
 * does not absorb a TIMEOUT under an expected-failure, so a case that hangs on
 * a missing element is written as an assertion about today's state instead.
 * See the /radar/calls describe block below.
 *
 *   1. A 200 with no row id flips both desk surfaces to tracked. The sheet
 *      refuses it (commit-sheet.tsx:145-150, "A 200 with no row id is not an
 *      acknowledgement."). The desk does not. Same class of inconsistency this
 *      ruling is about, surfaced rather than quietly fixed inside it.
 *
 * The deep-link test is the ONE genuine red. It is written to fail today and
 * to describe the bug precisely enough to fix from.
 *
 * :visible ON EVERY LOCATOR. The evening wrap mounts BOTH call trees and hides
 * one with CSS rather than unmounting it, so an unscoped locator resolves to
 * two nodes and strict mode fails for a reason that has nothing to do with the
 * gate.
 */
import { test as base, expect, type Page, type Route } from "@playwright/test";

/** One character. Under every threshold this control has ever had. */
const ONE = "x";
/** Eleven. One short of the floor that used to be here. */
const ELEVEN = "abcdefghijk";
/** Twelve. Exactly the old floor, which is now just a length. */
const TWELVE = "abcdefghijkl";
/** Nine once trimmed, and the boundary the column's btrim() also depends on. */
const PADDED_NINE = "   abc   ";
/** Twelve once trimmed. Padding is not content, but it is not poison either. */
const PADDED_TWELVE = "   abcdefghijkl   ";
/** The empty-field hint. Says what the note is for and asks for nothing. */
const HINT_EMPTY = "A sentence is what you will read back.";
/** Once anything is written. */
const HINT_WRITTEN = "Timestamped before the outcome is known.";
/** The press, in the one label it has. */
const PRESS = "Track this call";

/** The route no test in this file may reach. */
const ADOPT = "**/api/radar/claims/adopt";

/**
 * Every locator this suite uses, scoped to the visible tree and to one card.
 *
 * `.first()` after `:visible` is not belt-and-braces: a brief renders many
 * untracked footers and every assertion here is about ONE of them.
 */
function firstUntracked(page: Page) {
  const card = page.locator('[data-testid="track-state-untracked"]:visible').first();
  return {
    card,
    field: card.locator('[data-testid="track-note-field"]:visible').first(),
    hint: card.locator('[data-testid="track-note-hint"]:visible').first(),
    button: card.locator('[data-testid="track-call-button"]:visible').first(),
  };
}

/**
 * The fixture. The interception is installed by OVERRIDING `page`, so it is in
 * place before any test body runs and therefore before any `page.goto`.
 */
const test = base.extend<{ page: Page }>({
  /* The second parameter is Playwright's fixture callback. It is conventionally
     spelled `use`, and that spelling makes react-hooks/rules-of-hooks read it
     as React's `use` hook called outside a component: a real lint error, from a
     rule that matches the bare name and cannot know there is no React in this
     file. The parameter is positional, so the name is ours to choose. Renaming
     it is a smaller thing than carrying a suppression comment forever. */
  page: async ({ page }, runTest) => {
    await page.route(ADOPT, (route: Route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Blocked by the e2e fixture. No row was written.",
        }),
      }),
    );
    await runTest(page);
  },
});

test.use({ viewport: { width: 1440, height: 900 } });

/** Wait for a surface to have drawn at least one untracked footer. */
async function waitForUntracked(page: Page, path: string) {
  await page.goto(path);
  await expect(
    page.locator('[data-testid="track-state-untracked"]:visible').first(),
  ).toBeVisible({ timeout: 20_000 });
}

/* ────────────────────────────────────────────────────────────────────────
   SPEC 1. The field is offered, and it blocks nothing.

   All three surfaces run the same control
   (src/components/calls/TrackCallControl.tsx) and all three ADOPT: they post
   to /api/radar/claims/adopt, which accepts a note and requires neither its
   presence nor its length. So there is one expected behaviour and it is
   asserted identically on each.
   ──────────────────────────────────────────────────────────────────────── */

/** Every desk surface that offers a commitment. There is no fenced one left. */
const ADOPT_SURFACES = [
  { path: "/morning-brief", name: "morning brief" },
  { path: "/evening-wrap", name: "evening wrap" },
  { path: "/radar/calls", name: "radar calls" },
] as const;

for (const surface of ADOPT_SURFACES) {
  test.describe(`commit note: ${surface.name}`, () => {
    test(`${surface.name}: the note field is offered above the commit control`, async ({
      page,
    }) => {
      await waitForUntracked(page, surface.path);
      const { field, hint, button } = firstUntracked(page);

      await expect(field).toBeVisible();
      await expect(field).toHaveAttribute("aria-label", "Your reasoning");
      // NOT "A sentence is enough." That described a floor, and there is no
      // floor. This states the payoff, and it is the literal truth of the
      // Review screen, which reads this field back under "YOU WROTE".
      await expect(hint).toHaveText(HINT_EMPTY);

      // Above, not below. The reading order is the decision order: say why,
      // then choose how long, then commit.
      const fieldBox = await field.boundingBox();
      const buttonBox = await button.boundingBox();
      expect(fieldBox).not.toBeNull();
      expect(buttonBox).not.toBeNull();
      expect(fieldBox!.y).toBeLessThan(buttonBox!.y);

      // Three line boxes at 15px/1.6. One number for every surface.
      expect(fieldBox!.height).toBeGreaterThanOrEqual(72);
    });

    test(`${surface.name}: an empty note does not block the commit`, async ({ page }) => {
      await waitForUntracked(page, surface.path);
      const { button } = firstUntracked(page);

      // The starting state, untouched, and it is already open.
      await expect(button).toBeEnabled();
      // One label, in every state the reader can act from. "Write your
      // reasoning first" was the gate's voice and went with the gate.
      await expect(button).toHaveText(PRESS);
    });

    test(`${surface.name}: nothing changes at one, eleven or twelve characters`, async ({
      page,
    }) => {
      await waitForUntracked(page, surface.path);
      const { field, button } = firstUntracked(page);

      for (const value of [ONE, ELEVEN, TWELVE, PADDED_NINE, PADDED_TWELVE]) {
        await field.fill(value);
        await expect(button).toBeEnabled();
        await expect(button).toHaveText(PRESS);
      }
    });

    test(`${surface.name}: the hint acknowledges writing, it does not report a check`, async ({
      page,
    }) => {
      await waitForUntracked(page, surface.path);
      const { field, hint, button } = firstUntracked(page);

      // ONE character flips it. Under the old rule this needed twelve, and
      // under it the button moved too. Now only the hint moves.
      await field.fill(ONE);
      await expect(hint).toHaveText(HINT_WRITTEN);
      await expect(button).toBeEnabled();

      // Whitespace alone is not writing: it stores as null.
      await field.fill("     ");
      await expect(hint).toHaveText(HINT_EMPTY);
      // And the press is open anyway, which is the distinction.
      await expect(button).toBeEnabled();
    });
  });
}

/* ────────────────────────────────────────────────────────────────────────
   SPEC 3. The deep link. WRITTEN TO GO RED.

   /radar/calls?adopt=<id>#call-<id>, arriving signed in, leaves the scroll
   container at scrollTop 0 while the target card sits ~1300px down a 900px
   viewport. The gold ring IS applied, so the card is correctly ringed, 1300px
   below the fold, and the reader sees the top of the page.

   Mechanism: the scroll effect at page.tsx:266-272 depends on
   [adoptCallId, briefCalls], but the whole card tree is gated on
   `{loading ? null : (` at :526. The effect fires against a tree that has no
   call-<id> node yet, getElementById gives back null, and nothing re-runs
   it. Fix is one line: add `loading` to the dependency array and early-return
   while it is true. STILL NOT APPLIED, and the /radar sprint fence is no
   longer the reason: it is a scroll-behaviour change on a page this branch
   only touched to wire a note, and it deserves its own verification. It got
   worse rather than better, though, and that is recorded here: the arrival
   target is now a note field the reader is meant to type into, and they land
   1300px above it.

   toBeInViewport() is the assertion, deliberately. `toBeVisible()` passes on
   this bug: the node is rendered, painted and 1300px below the fold, which is
   exactly the state a reader complains about.
   ──────────────────────────────────────────────────────────────────────── */

test.describe("deep link from the brief email", () => {
  test("the deep-linked call is scrolled into view on arrival", async ({ page }) => {
    await waitForUntracked(page, "/radar/calls");

    // Take a real call id off the page rather than inventing one: ?adopt= with
    // an id that is not in the list would be a different bug.
    const target = page.locator('[id^="call-"]:visible').first();
    await expect(target).toBeVisible({ timeout: 20_000 });
    const domId = await target.getAttribute("id");
    expect(domId).toBeTruthy();
    const callId = domId!.replace(/^call-/, "");

    await page.goto(`/radar/calls?adopt=${callId}#call-${callId}`);

    const arrived = page.locator(`#call-${callId}:visible`);
    await expect(arrived).toBeVisible({ timeout: 20_000 });

    // The ring is applied today. This half passes.
    await expect(arrived).toHaveClass(/ring-2/);

    // This half is the bug. RED until the dependency array is fixed.
    await expect(arrived).toBeInViewport({ timeout: 12_000 });
  });
});

/* ────────────────────────────────────────────────────────────────────────
   SPEC 4. A failed write leaves the sentence on screen.

   The note lives in the CALLER's state keyed by call id, never inside
   UntrackedFooter, precisely so this survives. README: "A call that silently
   fails to save is the worst possible bug in this product." Losing the one
   sentence the reader wrote is most of the way there.
   ──────────────────────────────────────────────────────────────────────── */

test.describe("a failed adopt keeps the note", () => {
  /** Fill the first untracked card's note and press commit. */
  async function attempt(page: Page) {
    await waitForUntracked(page, "/morning-brief");
    const parts = firstUntracked(page);
    await parts.field.fill(TWELVE);
    await expect(parts.button).toBeEnabled();
    await parts.button.click();
    return parts;
  }

  test("a 500 leaves the note in the field", async ({ page }) => {
    // ON TOP of the fixture's refusal. Same shape, explicit status.
    await page.route(ADOPT, (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Could not track this call." }),
      }),
    );

    const { card, field } = await attempt(page);
    // The card must NOT read tracked, and the sentence must still be there.
    await expect(card).toBeVisible();
    await expect(field).toHaveValue(TWELVE);
  });

  test("a dropped connection leaves the note in the field", async ({ page }) => {
    await page.route(ADOPT, (route) => route.abort("failed"));

    const { card, field } = await attempt(page);
    await expect(card).toBeVisible();
    await expect(field).toHaveValue(TWELVE);
  });

  test("a 200 with no row id is not an acknowledgement", async ({ page }) => {
    /* EXPECTED TO FAIL TODAY, and the failure is the finding.
       The sheet rejects this at commit-sheet.tsx:145-150. Both desk surfaces
       treat any res.ok as success, so `{}` flips the card to tracked and the
       note is dropped: a write that did not happen, rendered as one that did.
       Declared rather than fixed inside this PR, because it is a behaviour
       change on the adopt path and deserves its own decision. */
    test.fail(true, "desk surfaces accept a 200 with no id; the sheet does not");

    await page.route(ADOPT, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({}),
      }),
    );

    const { card, field } = await attempt(page);
    await expect(card).toBeVisible();
    await expect(field).toHaveValue(TWELVE);
  });
});

/**
 * The commit-note gate, on the two desk surfaces (ruling 11, PR #694).
 *
 * A call is not adopted until the reader has written why. The phone commit
 * sheet has held that line since it shipped; this suite is the same line on
 * the desk, in the same words, at 1440x900.
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

/** Eleven characters. One short, on purpose. */
const ELEVEN = "abcdefghijk";
/** Twelve. The gate exactly. */
const TWELVE = "abcdefghijkl";
/** Nine once trimmed, and the boundary the column's btrim() also depends on. */
const PADDED_NINE = "   abc   ";
/** Twelve once trimmed. Padding is not content, but it is not poison either. */
const PADDED_TWELVE = "   abcdefghijkl   ";

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
   SPEC 1. The gate, on every surface that offers a commitment.
   ──────────────────────────────────────────────────────────────────────── */

/** The surfaces that hold the gate on this branch. */
const GATED_SURFACES = [
  { path: "/morning-brief", name: "morning brief" },
  { path: "/evening-wrap", name: "evening wrap" },
] as const;

for (const surface of GATED_SURFACES) {
  test.describe(`commit-note gate: ${surface.name}`, () => {
    test(`${surface.name}: the note field is offered above the commit control`, async ({
      page,
    }) => {
      await waitForUntracked(page, surface.path);
      const { field, hint, button } = firstUntracked(page);

      await expect(field).toBeVisible();
      await expect(field).toHaveAttribute("aria-label", "Your reasoning");
      await expect(hint).toHaveText("A sentence is enough.");

      // Above, not below. The reading order is the decision order: say why,
      // then choose how long, then commit.
      const fieldBox = await field.boundingBox();
      const buttonBox = await button.boundingBox();
      expect(fieldBox).not.toBeNull();
      expect(buttonBox).not.toBeNull();
      expect(fieldBox!.y).toBeLessThan(buttonBox!.y);

      // Three line boxes at 15px/1.6. One number for both surfaces.
      expect(fieldBox!.height).toBeGreaterThanOrEqual(72);
    });

    test(`${surface.name}: eleven characters do not unlock the commit`, async ({ page }) => {
      await waitForUntracked(page, surface.path);
      const { field, button } = firstUntracked(page);

      // Empty is the starting state, and it is already closed.
      await expect(button).toBeDisabled();
      await expect(button).toHaveText("Write your reasoning first");

      await field.fill(ELEVEN);
      await expect(button).toBeDisabled();
      await expect(button).toHaveText("Write your reasoning first");
    });

    test(`${surface.name}: twelve characters unlock it`, async ({ page }) => {
      await waitForUntracked(page, surface.path);
      const { field, hint, button } = firstUntracked(page);

      await field.fill(TWELVE);
      await expect(button).toBeEnabled();
      await expect(button).toHaveText("Track this call");
      await expect(hint).toHaveText("Timestamped before the outcome is known.");
    });

    test(`${surface.name}: padding is trimmed before counting, both ways`, async ({
      page,
    }) => {
      await waitForUntracked(page, surface.path);
      const { field, button } = firstUntracked(page);

      // Nine real characters wrapped in whitespace. The raw string is long
      // enough and the stored value is not. The column agrees: 0033 checks
      // length(btrim(commit_note)) > 0, and the route trims before storing.
      await field.fill(PADDED_NINE);
      await expect(button).toBeDisabled();

      // Twelve real characters, also wrapped. Padding is not content, but it
      // does not spoil the content it surrounds.
      await field.fill(PADDED_TWELVE);
      await expect(button).toBeEnabled();
    });
  });
}

/**
 * The third surface, stated rather than skipped.
 *
 * src/app/radar/calls/page.tsx is under the /radar sprint fence, so this
 * branch may not wire it and it keeps today's ungated footer. The exact diff
 * is in PR #694's body marked NOT APPLIED.
 *
 * This is written as an assertion about TODAY, not as an expected-failure of
 * the gate. Two reasons. It is deterministic and fast, where `test.fail()` on
 * a field that does not exist makes every locator wait out the full test
 * timeout, and Playwright does not absorb a TIMEOUT under an expected-failure
 * the way it absorbs an assertion failure: those cases were reported as hard
 * failures, which is worse than useless in a suite whose whole job is to
 * distinguish deliberate reds from real ones.
 *
 * It still tells you the day the proposal lands: wiring the page makes the
 * field appear and this test goes red, which is the signal to delete it and
 * move /radar/calls into GATED_SURFACES above.
 */
test.describe("commit-note gate: radar calls", () => {
  test("radar calls is still ungated, and that is the sprint fence", async ({ page }) => {
    await waitForUntracked(page, "/radar/calls");
    const { card, field, button } = firstUntracked(page);

    await expect(card).toBeVisible();
    // No field, so no gate. When this count becomes 1, wire the surface in.
    await expect(field).toHaveCount(0);
    // And the button is open with no reasoning written, which is the state
    // ruling 11 exists to end.
    await expect(button).toBeEnabled();
    await expect(button).toHaveText("Track this call");
  });
});

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
   while it is true. That diff is in the PR body, NOT APPLIED (sprint fence).

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

/**
 * /claim/[id], wired.
 *
 * The screen used to draw a fixture behind a production gate. It now reads one
 * `morning_brief_calls` row, and this suite is the proof of the three things
 * that wiring had to get right: the Ledger card opens the route, the id
 * contract survives end to end, and the commitment on the detail screen is the
 * same commitment the Ledger offers.
 *
 * NOTHING HERE MAY WRITE A ROW. `/api/radar/claims/adopt` is intercepted in the
 * FIXTURE below, before the first `page.goto` of every test in this file, so a
 * per-test override that someone forgets to add cannot reach the real route.
 * The default answer is a REFUSAL, not a success: a test that means to exercise
 * the happy path has to say so by installing its own handler on top, which is a
 * visible line in the test rather than a silent default. This is the pattern
 * `e2e/commit-note-gate.spec.ts:70-89` set, and the reason is the same: the
 * only configured target is the production database.
 *
 * THE SESSION comes from `signIn` in `e2e/auth-helper.ts` and that locator is
 * NOT re-derived here. `/auth` mounts BOTH forms unconditionally, so any
 * unscoped field locator resolves to two nodes and strict mode throws before a
 * character is typed; the helper already scopes to `form:visible`. It is called
 * only when there is no session cookie, because the repo's chromium project
 * carries one from `auth.setup.ts` and the proxy redirects an authenticated
 * reader away from `/auth` (src/proxy.ts:150), which would leave the helper
 * waiting for a Sign In button that is not there.
 *
 * EVERY LOCATOR IS ROLE OR TEXT BASED, measured rather than assumed: there are
 * ZERO `data-testid` attributes across `src/components/ledger/`,
 * `src/components/claim/` and `src/components/commit/`. The desk testids
 * (`track-state-untracked`, `track-note-field`) belong to
 * `TrackCallControl.tsx`, which is a different component on a different
 * surface, and copying them here would silently match nothing.
 *
 * TWO TESTS DEPEND ON WHAT THE DESK PUBLISHED TODAY: one needs a call still
 * open for commitment, one needs a call the reader has already taken. Neither
 * is created here, because creating one is a write. Each skips with a stated
 * reason when the day does not carry it, which is a fact about the brief and
 * not a failure of the screen.
 *
 * AND THE SECOND OF THOSE IS A REAL LIMITATION OF THIS SUITE, not just a quiet
 * day. Every route into the screen here starts at /ledger, which draws TODAY's
 * brief, so the only adopted calls this file can reach are calls adopted from
 * today. An independent measurement of this branch found an adopted call on an
 * OLDER brief and reached its screen by address; that is the state /claim
 * exists for, because a call adopted while its window is open has no /entry
 * page, and this suite structurally cannot navigate to it. Covering it needs an
 * entry point that lists a reader's open commitments, or a fixture target, and
 * neither exists today. Recorded rather than papered over.
 */
import { test as base, expect, type Page, type Route } from "@playwright/test";
import { signIn } from "./auth-helper";

/** The route no test in this file may reach. */
const ADOPT = "**/api/radar/claims/adopt";

/** Eleven characters. One short of COMMIT_NOTE_MIN, on purpose. */
const ELEVEN = "abcdefghijk";
/** Twelve. The gate exactly. */
const TWELVE = "abcdefghijkl";

/** COMMIT_PRESS_MS is 700. Long enough to clear it, short enough to be a test. */
const PRESS_MS = 1100;

/** A morning_brief_calls id, in the URL the Ledger card navigates to. */
const CLAIM_URL = /\/claim\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An id of the same shape that belongs to no row. */
const NOWHERE = "00000000-0000-4000-8000-000000000000";

/**
 * The fixture. The interception is installed by OVERRIDING `page`, so it is in
 * place before any test body runs and therefore before any `page.goto`.
 */
const test = base.extend<{ page: Page }>({
  /* The second parameter is Playwright's fixture callback, conventionally
     spelled `use`. That spelling makes react-hooks/rules-of-hooks read it as
     React's `use` hook called outside a component: a real lint error from a
     rule that matches the bare name. The parameter is positional, so the name
     is ours. */
  page: async ({ page }, runTest) => {
    await page.route(ADOPT, (route: Route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Blocked by the e2e fixture. No row was written." }),
      }),
    );
    await runTest(page);
  },
});

test.use({ viewport: { width: 390, height: 844 } });

/** Sign in only when there is no session, for the reason in the header. */
async function ensureSession(page: Page) {
  const cookies = await page.context().cookies();
  if (cookies.some((c) => /^sb-.+-auth-token/.test(c.name))) return;
  await signIn(page);
}

/**
 * One desk claim card on the Ledger, located from a control that carries text.
 *
 * The card's reading region is a real button the moment `onOpen` is passed
 * (ledger-claim-card.tsx:87-93) and it has no name of its own beyond the claim
 * it contains, so it is reached from the card rather than by name. The card is
 * two ancestors up from the tail control: control, then the meta row, then the
 * card. The reading button is the card's FIRST button, which is DOM order and
 * not a guess.
 */
function cardFrom(tail: ReturnType<Page["locator"]>) {
  const card = tail.locator("xpath=ancestor::div[2]");
  return { card, reading: card.locator("button").first() };
}

/** The Ledger, with at least one desk card drawn. */
async function openLedger(page: Page) {
  await ensureSession(page);
  await page.goto("/ledger");
  await expect(page.locator('[data-parity="ledger"]')).toBeVisible({ timeout: 20_000 });
}

/** The claim sentence as this screen draws it. The first paragraph, always. */
function claimSentence(page: Page) {
  return page.locator('[data-parity="claim"] p').first();
}

/* ────────────────────────────────────────────────────────────────────────
   SPEC 1. The entry point and the id contract, proved in one navigation.

   The card that opens the screen and the screen it opens must be about the
   same call. Comparing the SENTENCE character for character proves both ends:
   the route received the id the card was built from, and the loader read the
   row that id names. A uuid in the URL alone would prove only the first.
   ──────────────────────────────────────────────────────────────────────── */

test.describe("the Ledger card opens the claim", () => {
  test("the reading region navigates to the claim it draws", async ({ page }) => {
    await openLedger(page);

    const tail = page.getByRole("button", { name: "Track this call" }).first();
    if ((await tail.count()) === 0) {
      test.skip(true, "No open desk call on today's brief, so no card carries a tail control.");
      return;
    }

    const { reading } = cardFrom(tail);
    const onCard = (await reading.locator("p").first().innerText()).trim();
    expect(onCard.length).toBeGreaterThan(0);

    await reading.click();
    await page.waitForURL(CLAIM_URL, { timeout: 20_000 });

    const onScreen = (await claimSentence(page).innerText()).trim();
    expect(onScreen).toBe(onCard);
  });
});

/* ────────────────────────────────────────────────────────────────────────
   SPEC 2. The commitment, on the detail screen.

   One control, really enabled, opening the same global sheet the Ledger opens,
   under the same twelve character gate. The sheet is portalled to
   document.body, so every locator here is scoped to `page` and never to the
   screen subtree.
   ──────────────────────────────────────────────────────────────────────── */

test.describe("track this call, from the claim screen", () => {
  /** Reach an open claim's detail screen, or skip saying why. */
  async function openClaim(page: Page): Promise<boolean> {
    await openLedger(page);
    const tail = page.getByRole("button", { name: "Track this call" }).first();
    if ((await tail.count()) === 0) return false;
    await cardFrom(tail).reading.click();
    await page.waitForURL(CLAIM_URL, { timeout: 20_000 });
    return true;
  }

  test("there is exactly one Track control and it is not a disabled one", async ({ page }) => {
    if (!(await openClaim(page))) {
      test.skip(true, "No open desk call on today's brief.");
      return;
    }

    const track = page.getByRole("button", { name: "Track this call" });
    await expect(track).toHaveCount(1);
    await expect(track).toBeEnabled();
    // The screen shipped once with `aria-disabled` on this control and on a
    // square beside it that had no destination at all. Both are gone: a control
    // that announces itself and can never be operated is not a control.
    await expect(track).not.toHaveAttribute("aria-disabled", /.*/);
  });

  test("it opens the commit sheet, portalled out of the screen", async ({ page }) => {
    if (!(await openClaim(page))) {
      test.skip(true, "No open desk call on today's brief.");
      return;
    }

    await page.getByRole("button", { name: "Track this call" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();

    // Portalled to document.body rather than nested in the screen. This is the
    // property that keeps the fixed overlay off a transformed ancestor, so it
    // is asserted rather than assumed.
    const outside = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const screen = document.querySelector('[data-parity="claim"]');
      return dialog !== null && screen !== null && !screen.contains(dialog);
    });
    expect(outside).toBe(true);
  });

  test("eleven characters do not unlock the commit, twelve do", async ({ page }) => {
    if (!(await openClaim(page))) {
      test.skip(true, "No open desk call on today's brief.");
      return;
    }

    await page.getByRole("button", { name: "Track this call" }).click();
    const note = page.getByLabel("Your reasoning");
    await expect(note).toBeVisible();

    const closed = page.getByRole("button", { name: "Write your reasoning first" });
    await expect(closed).toBeDisabled();

    await note.fill(ELEVEN);
    await expect(closed).toBeDisabled();

    await note.fill(TWELVE);
    await expect(page.getByRole("button", { name: "Press to enter this on your ledger" })).toBeEnabled();
  });

  test("a refused write leaves the address and the claim alone", async ({ page }) => {
    if (!(await openClaim(page))) {
      test.skip(true, "No open desk call on today's brief.");
      return;
    }
    const address = page.url();
    const sentence = (await claimSentence(page).innerText()).trim();

    await page.getByRole("button", { name: "Track this call" }).click();
    await page.getByLabel("Your reasoning").fill(TWELVE);

    /* The press is driven from the KEYBOARD, and that is a choice rather than a
       convenience. The sheet animates up from the foot of the screen, so a
       bounding box read before it settles points at the scrim, and a pointer
       press there dismisses the sheet instead of keeping the control pressed:
       the first run of this test failed exactly that way. Space is also the path the
       sheet went out of its way to support, since a long press that exists only
       on a pointer is a control a keyboard reader cannot operate at all. */
    const press = page.getByRole("button", { name: "Press to enter this on your ledger" });
    await expect(press).toBeEnabled();
    await press.focus();
    await page.keyboard.down(" ");
    await page.waitForTimeout(PRESS_MS);
    await page.keyboard.up(" ");

    // The fixture answered 503. Nothing was written, so nothing may move: the
    // reader is still on the same claim, and the sentence is still the same
    // sentence. A silent navigation here would be a failed write rendered as a
    // successful one.
    await expect(page.getByText("This call was not entered.")).toBeVisible({ timeout: 15_000 });
    expect(page.url()).toBe(address);
    expect((await claimSentence(page).innerText()).trim()).toBe(sentence);
  });
});

/* ────────────────────────────────────────────────────────────────────────
   SPEC 3. An id that names nothing.

   A user_claims id pasted into /claim lands here too: both ids are uuids and
   the route does not guess, it looks the id up in morning_brief_calls.
   ──────────────────────────────────────────────────────────────────────── */

test.describe("an id with no row behind it", () => {
  test("renders missing, with no control and no counter", async ({ page }) => {
    await ensureSession(page);
    await page.goto(`/claim/${NOWHERE}`);

    await expect(page.getByText("There is no claim at this address.")).toBeVisible({
      timeout: 20_000,
    });

    // No commitment, because there is nothing to commit to.
    await expect(page.getByRole("button", { name: "Track this call" })).toHaveCount(0);
    // And no position counter. "2 / 5" over "there is no claim here" is the
    // header contradicting the body, and the counter is gone from the screen
    // entirely: its ordering is a confidence sort no reader is shown.
    await expect(page.locator('[data-parity="claim"]').getByText(/^\d+ \/ \d+$/)).toHaveCount(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────
   SPEC 4. A call already on the reader's record.

   This state is FOUND, never created: adopting one to reach it would be a
   write. It is also the state only this screen can show, because a claim
   adopted while its window is open has no /entry page: the record lists
   graded entries.
   ──────────────────────────────────────────────────────────────────────── */

test.describe("a call already on the record", () => {
  test("draws the ledger marker and offers no commitment", async ({ page }) => {
    await openLedger(page);

    const marker = page.locator('[data-parity="ledger"]').getByText("On your ledger").first();
    if ((await marker.count()) === 0) {
      test.skip(
        true,
        "No desk call on today's brief is on this reader's record, and adopting one to create the state would be a write.",
      );
      return;
    }

    await cardFrom(marker).reading.click();
    await page.waitForURL(CLAIM_URL, { timeout: 20_000 });

    await expect(page.locator('[data-parity="claim"]').getByText("On your ledger")).toBeVisible();
    await expect(page.getByRole("button", { name: "Track this call" })).toHaveCount(0);
  });
});

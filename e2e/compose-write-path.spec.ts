/**
 * /compose, wired: the two presses, the gate, and the body that goes on the wire.
 *
 * NOTHING HERE MAY WRITE A ROW OR CALL A MODEL. Both routes are intercepted in
 * the FIXTURE below, by OVERRIDING `page`, so the interception is installed
 * before any test body runs and therefore before any `page.goto`. A per-test
 * override that someone forgets to add cannot reach the real route: there is
 * no window in which the real `/api/radar/claims/author` could spend a Gemini
 * call, and none in which `/api/radar/claims` could insert.
 *
 * The default answer on the WRITE route is a refusal, not a success. A test
 * that means to exercise the acknowledged path has to say so by installing its
 * own handler on top, which is a visible line in the test rather than a silent
 * default. The READ-BACK route is fulfilled with a canned proposal, because
 * every state past the first press is unreachable without one.
 *
 * /compose is in MOBILE_REDESIGN_DEV_PATHS (src/proxy.ts), so it is open in
 * dev and none of this needs a session.
 *
 * THE ASSERTION THIS FILE EXISTS FOR is `resolution_window_end` being FORWARD
 * of today in America/Los_Angeles. `/api/radar/claims` POST requires
 * `resolution_window_end > todayIso` and does not refuse when it fails: it
 * writes the row with `gradeable: false`. So a screen resolving its window off
 * the old fixed fixture anchor would pass every other check in this file while
 * writing claims that can never be graded, and nobody would find out until a
 * reader went looking for a verdict that was never going to arrive.
 */
import { test as base, expect, type Page, type Route } from "@playwright/test";

/* ── the gate boundaries, spelled out ─────────────────────────────────── */

/** Eleven characters of reasoning. One short, on purpose. */
const ELEVEN = "abcdefghijk";
/** Twelve. The gate exactly (COMMIT_NOTE_MIN). */
const TWELVE = "abcdefghijkl";
/** Nine once trimmed, and the boundary the column's btrim() also depends on. */
const PADDED_NINE = "   abc   ";
/** Twelve once trimmed. Padding is not content, but it is not poison either. */
const PADDED_TWELVE = "   abcdefghijkl   ";

/** Past DRAFT_MIN_CHARS (24). The example sentence the screen itself suggests. */
const DRAFT = "NVDA gives back the ramp hype by earnings";

/** A note with real padding on both ends, so the trim is observable on the wire. */
const PADDED_NOTE = "   the regulated book carries too much drag   ";

/* ── the routes ───────────────────────────────────────────────────────── */

const AUTHOR = "**/api/radar/claims/author";
/** A predicate, not a glob. `/api/radar/claims` must never catch its own
 *  `/author` child, and a function saying so is not a thing to get wrong. */
const isWrite = (url: URL) => url.pathname === "/api/radar/claims";

/** Today's US-Pacific session date, the same convention `todayPt()` uses. */
function todayPt(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

/** An ISO date n calendar days after another. UTC arithmetic, no local drift. */
function plusDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * The canned read-back. BEARISH on purpose: the direction assertion below is
 * only worth anything if the chip the reader presses disagrees with what the
 * route proposed. Its window is exactly a week, so the RESOLVES chip
 * preselects `week` and the screen has a bucket to resolve from.
 */
function cannedProposal() {
  const today = todayPt();
  return {
    user_claim: DRAFT,
    proposal: {
      claim_type: "ticker",
      target_symbol: "NVDA",
      expected_direction: "bearish",
      resolution_window_start: today,
      resolution_window_end: plusDays(today, 7),
      evidence_entities: ["NVDA"],
      confidence_in_reduction: 0.7,
      gradeable: true,
      gradeability_note: null,
      gradeable_alternative: null,
    },
  };
}

/* ── the fixture ──────────────────────────────────────────────────────── */

interface Recorder {
  /** Every request that reached either claim route, in order. */
  seen: string[];
  /** The body of the last write attempt, or null if none was made. */
  written: Record<string, unknown> | null;
}

const test = base.extend<{ page: Page; recorder: Recorder }>({
  recorder: async ({}, runTest) => {
    await runTest({ seen: [], written: null });
  },

  /* The second parameter is Playwright's fixture callback. It is conventionally
     spelled `use`, and that spelling makes react-hooks/rules-of-hooks read it
     as React's `use` hook called outside a component: a real lint error from a
     rule that matches the bare name and cannot know there is no React here.
     The parameter is positional, so the name is ours to choose. */
  page: async ({ page, recorder }, runTest) => {
    await page.route(AUTHOR, (route: Route) => {
      recorder.seen.push("author");
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(cannedProposal()),
      });
    });

    await page.route(isWrite, (route: Route) => {
      recorder.seen.push("write");
      recorder.written = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Blocked by the e2e fixture. No row was written.",
        }),
      });
    });

    await runTest(page);
  },
});

/* The screen is `md:hidden`; the desktop half of the route is a different
   tree entirely. 390x844 is the design frame. */
test.use({ viewport: { width: 390, height: 844 } });

/* ── the handles ──────────────────────────────────────────────────────── */

function compose(page: Page) {
  return {
    draft: page.locator("#compose-claim"),
    note: page.locator("#compose-note"),
    submit: page.getByTestId("compose-submit"),
    chip: (name: string) => page.getByRole("button", { name, exact: true }),
  };
}

/** Open the screen with a draft and a note that both clear their gates. */
async function opened(page: Page, note = TWELVE) {
  await page.goto("/compose");
  const c = compose(page);
  await expect(c.draft).toBeVisible();
  await c.draft.fill(DRAFT);
  await c.note.fill(note);
  return c;
}

/** Open, read back, and stand in front of an unwritten gradeable proposal. */
async function readBack(page: Page, note = TWELVE) {
  const c = await opened(page, note);
  await expect(c.submit).toHaveText("Read it back");
  await c.submit.click();
  await expect(c.submit).toHaveText("Track it");
  return c;
}

/* ════════════════════════════════════════════════════════════════════════
   1. NOTHING FIRES UNTIL THE READER PRESSES.
   ════════════════════════════════════════════════════════════════════════ */

test.describe("no request before the press", () => {
  test("typing a whole claim and a whole note reaches neither route", async ({
    page,
    recorder,
  }) => {
    const c = await opened(page);

    // Both fields full, the control offering the read-back, and nothing sent.
    await expect(c.submit).toBeEnabled();
    await expect(c.submit).toHaveText("Read it back");
    expect(recorder.seen).toEqual([]);

    // The press is what sends, and it sends the READ-BACK, never the write.
    await c.submit.click();
    await expect(c.submit).toHaveText("Track it");
    expect(recorder.seen).toEqual(["author"]);
  });
});

/* ════════════════════════════════════════════════════════════════════════
   2. THE GATE. Compose requires the reasoning before it will even READ THE
   CLAIM BACK, which is one conjunct more than the commit sheet requires. That
   is deliberate (see fixture.ts) and is asserted here as today's behaviour so
   a change to it is a visible red rather than a quiet drift.
   ════════════════════════════════════════════════════════════════════════ */

test.describe("the twelve-character gate", () => {
  test("eleven characters do not unlock the read-back", async ({ page, recorder }) => {
    await page.goto("/compose");
    const c = compose(page);
    await c.draft.fill(DRAFT);

    // Empty is the starting state and it is already closed.
    await expect(c.submit).toBeDisabled();
    await expect(c.submit).toHaveText("Write the claim and your reasoning");

    await c.note.fill(ELEVEN);
    await expect(c.submit).toBeDisabled();
    await expect(c.submit).toHaveText("Write the claim and your reasoning");
    expect(recorder.seen).toEqual([]);
  });

  test("twelve characters unlock it", async ({ page }) => {
    await page.goto("/compose");
    const c = compose(page);
    await c.draft.fill(DRAFT);
    await c.note.fill(TWELVE);
    await expect(c.submit).toBeEnabled();
    await expect(c.submit).toHaveText("Read it back");
  });

  test("padding is trimmed before counting, both ways", async ({ page }) => {
    await page.goto("/compose");
    const c = compose(page);
    await c.draft.fill(DRAFT);

    /* Nine real characters wrapped in whitespace. The raw string is long
       enough and the stored value would not be. The column agrees: 0033
       checks length(btrim(commit_note)) > 0, and both write routes trim
       before storing. */
    await c.note.fill(PADDED_NINE);
    await expect(c.submit).toBeDisabled();

    // Twelve real characters, also wrapped. Padding does not spoil content.
    await c.note.fill(PADDED_TWELVE);
    await expect(c.submit).toBeEnabled();
  });
});

/* ════════════════════════════════════════════════════════════════════════
   3. THE BODY ON THE WIRE. The whole point of the unit.
   ════════════════════════════════════════════════════════════════════════ */

test.describe("what the write actually carries", () => {
  test("the window ends FORWARD of today in America/Los_Angeles", async ({
    page,
    recorder,
  }) => {
    const c = await readBack(page);
    await c.submit.click();
    await expect.poll(() => recorder.written).not.toBeNull();

    const body = recorder.written!;
    const today = todayPt();
    const end = body.resolution_window_end as string;

    expect(end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    /* THE ASSERTION. `/api/radar/claims` POST requires windowEnd > todayIso and
       degrades to gradeable:false rather than refusing, so a window resolved
       off a fixed past anchor is written, rendered as a success, and never
       graded. ISO dates sort lexicographically, so this is the same comparison
       the route makes. */
    expect(end > today).toBe(true);

    // And it opens today, sent explicitly rather than left to the route's
    // `?? todayIso` fallback, so the request is auditable on its own.
    expect(body.resolution_window_start).toBe(today);
  });

  test("the reasoning arrives trimmed, and carries no timestamp", async ({
    page,
    recorder,
  }) => {
    const c = await readBack(page, PADDED_NOTE);
    await c.submit.click();
    await expect.poll(() => recorder.written).not.toBeNull();

    const body = recorder.written!;
    expect(body.commit_note).toBe(PADDED_NOTE.trim());

    /* The CLIENT must not stamp the moment. `commit_note` and `commit_note_at`
       are written by the route in one object from one decision, which is what
       makes a note with no timestamp and a timestamp with no note both
       unreachable. A client that sent its own would be a second source for
       half of that pair. */
    expect("commit_note_at" in body).toBe(false);
  });

  test("expected_direction is the CHIP, not the proposal", async ({ page, recorder }) => {
    const c = await readBack(page);

    // The canned read-back said bearish. The reader disagrees.
    await c.chip("Bullish").click();
    await expect(c.chip("Bullish")).toHaveAttribute("aria-pressed", "true");

    await c.submit.click();
    await expect.poll(() => recorder.written).not.toBeNull();

    /* `direction` and `horizon` are independent state: the chips call their
       setters and never touch `proposal`. A body built from
       proposal.expected_direction would discard this press silently, on the
       one press that writes a row. */
    expect(recorder.written!.expected_direction).toBe("bullish");
    expect(recorder.written!.target_symbol).toBe("NVDA");
  });

  test("the two fields the screen never draws are still carried", async ({
    page,
    recorder,
  }) => {
    const c = await readBack(page);
    await c.submit.click();
    await expect.poll(() => recorder.written).not.toBeNull();

    /* Neither is rendered anywhere on this screen, and both are produced by
       the author route and accepted by the insert. Dropping them would store
       an empty array and a null on every authored claim. */
    expect(recorder.written!.evidence_entities).toEqual(["NVDA"]);
    expect(recorder.written!.confidence_in_reduction).toBe(0.7);
  });

  test("the claim is the reader's own words, trimmed and verbatim", async ({
    page,
    recorder,
  }) => {
    const c = await readBack(page);
    await c.submit.click();
    await expect.poll(() => recorder.written).not.toBeNull();
    expect(recorder.written!.user_claim).toBe(DRAFT);
  });
});

/* ════════════════════════════════════════════════════════════════════════
   4. A FAILED WRITE KEEPS EVERYTHING AND OFFERS NO RETRY.

   The note is the reader's own sentence and exists nowhere else. The proposal
   costs another multi-second model call. Neither may be cleared by a failure.

   And the control must not offer to post again: `/api/radar/claims` POST has
   no idempotency guard and an authored claim has no natural key, so a second
   press after a dropped connection writes a SECOND row describing the same
   view. The reader is sent to /ledger to look instead.
   ════════════════════════════════════════════════════════════════════════ */

test.describe("an unacknowledged write", () => {
  /** Reach a gradeable proposal and press the write once. */
  async function attempt(page: Page) {
    const c = await readBack(page, PADDED_TWELVE);
    await c.submit.click();
    await expect(c.submit).toHaveText("Not acknowledged");
    return c;
  }

  test("a 503 keeps the claim, the reasoning and the read-back", async ({ page }) => {
    // The fixture's own refusal is already a 503. No override needed.
    const c = await attempt(page);

    await expect(c.draft).toHaveValue(DRAFT);
    await expect(c.note).toHaveValue(PADDED_TWELVE);
    // The READ AS card is still there, so the model call is not spent twice.
    await expect(page.getByText("READ AS")).toBeVisible();
  });

  test("a dropped connection lands in the same place", async ({ page }) => {
    await page.route(isWrite, (route) => route.abort("failed"));
    const c = await attempt(page);
    await expect(c.note).toHaveValue(PADDED_TWELVE);
  });

  test("a 200 with no row id is not an acknowledgement", async ({ page }) => {
    await page.route(isWrite, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ gradeable: true }),
      }),
    );
    const c = await attempt(page);
    await expect(c.note).toHaveValue(PADDED_TWELVE);
  });

  test("the control does not offer to post again, and /ledger does", async ({
    page,
    recorder,
  }) => {
    const c = await attempt(page);

    await expect(c.submit).toBeDisabled();
    const before = recorder.seen.filter((s) => s === "write").length;
    expect(before).toBe(1);

    // A real link, 44px tall, to the one place that can answer the question.
    const out = page.getByRole("link", { name: "Open your ledger and check" });
    await expect(out).toBeVisible();
    await expect(out).toHaveAttribute("href", "/ledger");
    const box = await out.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);

    /* Editing does NOT reopen the control. The first write may well have
       landed, and re-posting is how one view becomes two rows. */
    await c.draft.fill(`${DRAFT} and then some more words entirely`);
    await expect(c.submit).toBeDisabled();
    expect(recorder.seen.filter((s) => s === "write").length).toBe(before);
  });
});

/* ════════════════════════════════════════════════════════════════════════
   5. THE ACKNOWLEDGED PATH. Installed ON TOP of the fixture's refusal, which
   is the visible line that says this test means to succeed.
   ════════════════════════════════════════════════════════════════════════ */

test.describe("an acknowledged write", () => {
  test("a row id puts the call on the ledger and locks the screen", async ({ page }) => {
    await page.route(isWrite, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "00000000-0000-4000-8000-000000000000",
          gradeable: true,
          noteWritten: true,
        }),
      }),
    );

    const c = await readBack(page);
    await c.submit.click();

    await expect(c.submit).toHaveText("◆ On your ledger");
    await expect(c.submit).toBeDisabled();
    // The reader's words stay on screen and stop being editable.
    await expect(c.draft).toHaveValue(DRAFT);
    await expect(c.draft).toHaveAttribute("readonly", "");
  });
});

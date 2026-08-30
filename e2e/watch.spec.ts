import { test, expect, type Page } from "@playwright/test";

/**
 * /watch, wired.
 *
 * WHAT THIS SPEC CAN AND CANNOT REACH, stated up front because one of the two
 * halves of the tri-state is not reachable from a browser at all.
 *
 * `/watch` is a SERVER COMPONENT. Its reads go from the Next server to
 * Postgres, so `page.route()` never sees them: interception cannot force a
 * per-entry article read to fault, and it cannot populate the signed-in
 * account's empty watchlist either. The loader's decisions are proven
 * deterministically instead, in `tests/unit/watch-loader-tristate.test.ts`,
 * which hands `loadWatch` a client whose queries fail on command and asserts
 * that a faulted entry lands in `watchlistCouldNotRead` and in neither
 * `watchlist` nor `quietNames`.
 *
 * What a browser CAN prove, and what is proven here:
 *   1. the screen renders off a read rather than the unwired notice;
 *   2. the tracked-views tier and the pinned-espresso hero are absent;
 *   3. the empty state is a read answering empty, with a real destination;
 *   4. the short state is CENTRED, not 436px of trailing dead screen;
 *   5. price is a client read, and an aborted one draws NOTHING rather than a
 *      wrong number. That is the one read on this screen `page.route()` owns,
 *      and it is intercepted here.
 *
 * EVERY NON-GET IS ABORTED. Doubly load-bearing: this unit must not write, and
 * `src/app/radar/watchlist/page.tsx:619-680` fires a real DELETE then POST per
 * stale sector entry on load. Nothing here navigates there, and nothing here
 * can write if something later does.
 */

const VW = 390;
const VH = 844;

/** The unwired copy this branch removed. Its return is the regression. */
const UNWIRED = "Watch is not wired to a source yet.";

/** Signed-out `/watch` is a development path (`src/proxy.ts`), not a prod one. */
const remote = !!process.env.E2E_BASE_URL?.startsWith("https://");

async function readOnly(page: Page) {
  await page.route("**/api/**", (r) =>
    r.request().method() === "GET" ? r.continue() : r.abort(),
  );
}

async function setTheme(page: Page, theme: "light" | "dark") {
  // localStorage plus the `dark` class. `prefers-color-scheme` does nothing in
  // this app, so `emulateMedia` would silently measure light twice.
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("signalera_theme", t);
    } catch {
      /* a context with no storage access still renders light, which is the
         default the class toggle below corrects. */
    }
  }, theme);
}

/**
 * The gap above the tier content and the gap below it, in the screen root.
 *
 * A centred short state has two gaps of roughly equal size. PR #710's 415px on
 * `/claim` was entirely at the bottom with the content jammed to the top, which
 * is the shape this measurement exists to catch.
 */
async function gaps(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-parity="watch"]') as HTMLElement;
    const body = root.children[1] as HTMLElement;
    let top = Infinity;
    let bottom = -Infinity;
    const walk = (el: Element) => {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return;
      const hasText = Array.from(el.childNodes).some(
        (n) => n.nodeType === 3 && (n.textContent ?? "").trim().length > 0,
      );
      // Painted counts even when aria-hidden: the shimmer bars are hidden from
      // assistive tech and very much on screen. Only a block that paints
      // nothing is void, which is the tab-bar clearance.
      const paints =
        cs.backgroundColor !== "rgba(0, 0, 0, 0)" || cs.backgroundImage !== "none";
      if (hasText || paints) {
        const r = el.getBoundingClientRect();
        if (r.height > 0) {
          if (r.top < top) top = r.top;
          if (r.bottom > bottom) bottom = r.bottom;
        }
      }
      for (const c of Array.from(el.children)) walk(c);
    };
    walk(body);
    const rootBox = root.getBoundingClientRect();
    const bodyBox = body.getBoundingClientRect();
    return {
      state: root.getAttribute("data-watch-state"),
      rootHeight: rootBox.height,
      lead: top - bodyBox.top,
      trailInBody: bodyBox.bottom - bottom,
      trailTotal: rootBox.bottom - bottom,
    };
  });
}

/* ── signed in: the reader's own read ────────────────────────────────── */

test.describe("Watch, signed in", () => {
  test.beforeEach(async ({ page }) => {
    await readOnly(page);
    await page.setViewportSize({ width: VW, height: VH });
  });

  test("renders off a read, not the unwired notice", async ({ page }) => {
    await page.goto("/watch");
    const screen = page.locator('[data-parity="watch"]');
    await expect(screen).toBeVisible({ timeout: 20_000 });
    await expect(screen).not.toContainText(UNWIRED);
    // Both shipped tiers are drawn, off the loader.
    await expect(screen.getByText("watchlist", { exact: true })).toBeVisible();
    await expect(screen.getByText("following", { exact: true })).toBeVisible();
  });

  test("the omitted tier is absent, not drawn empty, and is absent silently", async ({
    page,
  }) => {
    await page.goto("/watch");
    const screen = page.locator('[data-parity="watch"]');
    await expect(screen).toBeVisible({ timeout: 20_000 });
    // No rule, and no empty-tier notice standing in for one. "No tracked views
    // yet" is a claim about the reader and needs a read behind it.
    //
    // The comment that stood here said `user_claims` has no headline column.
    // That was measured wrong and is retracted: `user_claim` IS the headline
    // (sql/0012:10-11). The tier is absent because no row is a tracked view,
    // which is a claim about the product. See `src/components/watch/omissions.ts`.
    await expect(screen.getByText("tracked views", { exact: true })).toHaveCount(0);
    await expect(screen).not.toContainText("No tracked views yet");
    await expect(screen).not.toContainText("NO DIRECTION, NO WINDOW");
    // AND NO EXPLANATION EITHER, which is what changed. PR #731 put the reason
    // on screen; the ruling of 2026-08-29 narrowed that to absences whose
    // silence would mislead, and a tier nothing on this screen names is not
    // one. The finding is unchanged and lives in `omissions.ts`.
    await expect(screen).not.toContainText("no direction and no window");
    // ALL FOUR NOTES ARE GONE, staleness last and for a different reason: the
    // owner ruled it a caption on a wrong sentence, and issue #748 is the fix.
    // The BLOCK is kept with an empty array so issue #748 has something to fill, and
    // it must render nothing at all in the meantime: no container, no rule, no
    // heading. Asserted on the element, because "no visible text" would also
    // pass for an empty section that still draws a hairline and a margin.
    await expect(screen).not.toContainText("NOT SHOWN HERE");
    await expect(screen).not.toContainText("A staleness line");
    await expect(screen.locator('section[aria-labelledby="watch-omitted"]')).toHaveCount(0);
  });

  test("an empty watchlist is a read answering empty, and names a destination", async ({
    page,
  }) => {
    await page.goto("/watch");
    const screen = page.locator('[data-parity="watch"]');
    await expect(screen).toBeVisible({ timeout: 20_000 });
    // The test account's watchlist is empty, so this is the honest minimum: a
    // real read that came back with nothing.
    await expect(screen).toContainText("Nothing on your watchlist yet");
    // And the copy that says where they are added goes there. A real anchor,
    // with a real href.
    const desk = screen.getByRole("link", { name: "Open the watchlist desk" });
    await expect(desk).toHaveAttribute("href", "/radar/watchlist");
    const box = await desk.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test("nothing is reported as unread when nothing faulted", async ({ page }) => {
    await page.goto("/watch");
    const screen = page.locator('[data-parity="watch"]');
    await expect(screen).toBeVisible({ timeout: 20_000 });
    // The per-entry omission notice is drawn ONLY off a real fault. Its
    // presence here would mean the loader is inventing one; its wording is
    // asserted by the unit test, which can force the fault.
    await expect(screen).not.toContainText("Could not read:");
  });

  for (const theme of ["light", "dark"] as const) {
    test(`the short state is centred rather than trailing, ${theme}`, async ({ page }) => {
      await setTheme(page, theme);
      await page.goto("/watch");
      await page.evaluate((t) => {
        document.documentElement.classList.toggle("dark", t === "dark");
      }, theme);
      await expect(page.locator('[data-parity="watch"]')).toBeVisible({ timeout: 20_000 });
      const g = await gaps(page);

      expect(g.state).toBe("sparse");
      // Centred: the two gaps inside the body are within a line of each other.
      expect(Math.abs(g.lead - g.trailInBody)).toBeLessThan(20);
      // And nowhere near the 436.3px this state measured before the reflow.
      expect(g.trailTotal).toBeLessThan(260);
    });
  }
});

/* ── signed out on a development build: sample content, and the price read ── */

test.describe("Watch, sample content", () => {
  // A signed-out context. `/watch` is in MOBILE_REDESIGN_DEV_PATHS, so a
  // development server serves it; a production target sends the visitor to
  // /auth instead, which is the correct behaviour and not this spec's subject.
  test.use({ storageState: { cookies: [], origins: [] } });
  test.skip(remote, "signed-out /watch is a development path, not a prod one");

  test.beforeEach(async ({ page }) => {
    await readOnly(page);
    await page.setViewportSize({ width: VW, height: VH });
  });

  test("price is absent until the quote read answers, never wrong", async ({ page }) => {
    // THE ONE READ ON THIS SCREEN A BROWSER OWNS. Aborting it must leave the
    // card with no percentage on it at all: an absent price is honest, a stale
    // or zeroed one is the defect the desk still carries.
    await page.route("**/api/watchlist-quotes**", (r) => r.abort());
    await page.goto("/watch");
    const screen = page.locator('[data-parity="watch"]');
    await expect(screen).toBeVisible({ timeout: 20_000 });
    await expect(screen).toContainText("Constellation Energy");
    await page.waitForTimeout(1500);
    // No signed percentage anywhere on the screen.
    await expect(screen.locator("text=/[+-]\\d+\\.\\d\\d%/")).toHaveCount(0);
  });

  test("a quote that answers is drawn beside the name", async ({ page }) => {
    await page.route("**/api/watchlist-quotes**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ quotes: { CEG: { price: "1.00", pct: -1.5 } } }),
      }),
    );
    await page.goto("/watch");
    const screen = page.locator('[data-parity="watch"]');
    await expect(screen).toBeVisible({ timeout: 20_000 });
    await expect(screen.getByText("-1.50%")).toBeVisible({ timeout: 10_000 });
    // NVDA was not in the answer, so it draws no price rather than a zero.
    await expect(screen).not.toContainText("+0.00%");
  });

  test("muted follows are a third state, not folded into quiet", async ({ page }) => {
    await page.goto("/watch");
    const screen = page.locator('[data-parity="watch"]');
    await expect(screen).toBeVisible({ timeout: 20_000 });
    // The count carries all three, and the tail says what muted means. The
    // desktop's predicate would report four quiet here rather than three.
    await expect(screen).toContainText("3 with coverage · 3 quiet · 1 muted");
    await expect(screen).toContainText("One follow is muted, so it was not checked at all.");
  });

  test("the hero is not drawn: every entry is the same card", async ({ page }) => {
    await page.goto("/watch");
    const screen = page.locator('[data-parity="watch"]');
    await expect(screen).toBeVisible({ timeout: 20_000 });
    // The design's hero headline sits at 17px on pinned espresso. Nothing on
    // this screen is promoted, so the strongest story is set like the rest.
    const headline = screen.getByText(
      "Constellation lifts contracted volume guidance after fourth data centre agreement",
    );
    await expect(headline).toBeVisible();
    const fs = await headline.evaluate((el) => getComputedStyle(el).fontSize);
    expect(fs).toBe("14px");
  });

  test("every lens chip clears the 44px floor and filters", async ({ page }) => {
    await page.goto("/watch");
    const group = page.getByRole("group", { name: "Watchlist filter" });
    await expect(group).toBeVisible({ timeout: 20_000 });
    for (const label of ["All", "Public", "Private", "Industries"]) {
      const chip = group.getByRole("button", { name: label, exact: true });
      const box = await chip.boundingBox();
      expect(box!.height, `${label} chip height`).toBeGreaterThanOrEqual(44);
    }
    await group.getByRole("button", { name: "Private", exact: true }).click();
    const screen = page.locator('[data-parity="watch"]');
    await expect(screen).toContainText("1 with news");
    // The quiet line describes public names, so it is hidden under this lens
    // rather than describing a set the screen is not showing.
    await expect(screen).not.toContainText("No news today:");
  });

  test("the mobile layout is absent above the breakpoint", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/watch");
    await expect(page.getByText("Watch is a mobile surface.")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-parity="watch"]')).toBeHidden();
  });
});

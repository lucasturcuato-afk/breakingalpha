import { test, expect } from "@playwright/test";

test.describe("Dashboard", () => {
  test("loads dashboard with greeting and stats", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForURL("**/dashboard");

    // Greeting should resolve (not show skeleton forever)
    await expect(page.getByText(/Good (morning|afternoon|evening)/).first()).toBeVisible({
      timeout: 10_000,
    });

    // Date and market status line
    // Market status now reads "Markets steady", "Markets up" etc. in the top bar.
    await expect(page.getByText(/Markets (steady|up|down|open|closed)/i).first()).toBeVisible({ timeout: 10_000 });

    // Stat cards should be present
    await expect(page.getByText("S&P 500").first()).toBeVisible();
    // The stat tiles were replaced by the desk's sections; assert the
    // sections the dashboard draws today.
    await expect(page.getByRole("heading", { name: "Top Stories" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your calls" })).toBeVisible();
  });

  test("AI signal bar renders with CTA", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(page.getByText("Signalera AI").first()).toBeVisible({ timeout: 10_000 });
    // CTA link should exist — scope to main content area, pick first match
    // `.or()` of two `.first()` locators still resolves to every match of
    // either, and the dashboard links to both briefs, so it tripped strict
    // mode. Take the first of the union instead.
    const cta = page.locator("main a[href='/morning-brief'], main a[href='/evening-wrap']");
    const altCta = page.getByRole("link", { name: /Get (morning|evening)|Read full brief/ });
    await expect(cta.or(altCta).first()).toBeVisible();
  });

  test("stories section loads or shows empty state", async ({ page }) => {
    await page.goto("/dashboard");

    // Wait for loading to finish — either stories appear or empty state
    const stories = page.getByText("Top Stories").first();
    const empty = page.getByText("No stories yet");

    await expect(stories.or(empty)).toBeVisible({ timeout: 15_000 });

    // No error state should be visible
    await expect(page.locator("text=Application error")).not.toBeVisible();
  });

  test("view all link navigates to live feed", async ({ page }) => {
    await page.goto("/dashboard");
    const viewAll = page.getByRole("link", { name: /View all/ }).first();

    // Only test if stories section loaded (not empty)
    if (await viewAll.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await viewAll.click();
      await page.waitForURL("**/live-feed");
      await expect(page).toHaveURL(/\/live-feed/);
    }
  });

  test("right panel widgets are visible", async ({ page }) => {
    await page.goto("/dashboard");

    // Right panel widget headings are h3 elements
    await expect(page.getByRole("heading", { name: /Daily Briefs/i })).toBeVisible({ timeout: 10_000 });
    // The right rail draws the account's record and follows, not a theses widget.
    await expect(page.getByRole("heading", { name: /Signalera.s record/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Following" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Watchlist/i })).toBeVisible();
  });
});

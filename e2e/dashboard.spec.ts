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
    await expect(page.getByText(/Markets (Open|Closed)|Session (open|closed)/).first()).toBeVisible();

    // Stat cards should be present
    await expect(page.getByText("S&P 500").first()).toBeVisible();
    await expect(page.getByText("VIX Fear Index").first()).toBeVisible();
    await expect(page.getByText("10Y Yield").first()).toBeVisible();
    await expect(page.getByText("Signals Today").first()).toBeVisible();
  });

  test("AI signal bar renders with CTA", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(page.getByText("Signalera AI").first()).toBeVisible({ timeout: 10_000 });
    // CTA link should exist — scope to main content area, pick first match
    const cta = page.locator("main a[href='/morning-brief'], main a[href='/evening-wrap']").first();
    const altCta = page.getByRole("link", { name: /Get (morning|evening)|Read full brief/ }).first();
    await expect(cta.or(altCta)).toBeVisible();
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
    await expect(page.getByRole("heading", { name: /Active Theses/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Watchlist/i })).toBeVisible();
  });
});

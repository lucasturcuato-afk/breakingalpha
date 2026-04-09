import { test, expect } from "@playwright/test";

test.describe("Dashboard", () => {
  test("loads dashboard with greeting and stats", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForURL("**/dashboard");

    // Greeting should resolve (not show skeleton forever)
    await expect(page.getByText(/Good (morning|afternoon|evening)/)).toBeVisible({
      timeout: 10_000,
    });

    // Date and market status line
    await expect(page.getByText(/Markets (Open|Closed)/)).toBeVisible();

    // 4 stat cards should be present
    await expect(page.getByText("S&P 500")).toBeVisible();
    await expect(page.getByText("VIX Fear Index")).toBeVisible();
    await expect(page.getByText("10Y Yield")).toBeVisible();
    await expect(page.getByText("Signals Today")).toBeVisible();
  });

  test("AI signal bar renders with CTA", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(page.getByText("Signalera AI")).toBeVisible({ timeout: 10_000 });
    // CTA link should exist (either morning brief or evening wrap)
    const cta = page.locator("a[href='/morning-brief'], a[href='/evening-wrap']");
    await expect(cta).toBeVisible();
  });

  test("stories section loads or shows empty state", async ({ page }) => {
    await page.goto("/dashboard");

    // Wait for loading to finish — either stories appear or empty state
    const stories = page.getByText("Top Stories");
    const empty = page.getByText("No stories yet");
    await expect(stories.or(empty)).toBeVisible({ timeout: 15_000 });

    // No error state should be visible
    await expect(page.locator(".text-signal-dn")).not.toBeVisible();
  });

  test("view all link navigates to live feed", async ({ page }) => {
    await page.goto("/dashboard");
    const viewAll = page.getByRole("link", { name: /View all/ });

    // Only test if stories section loaded (not empty)
    if (await viewAll.isVisible()) {
      await viewAll.click();
      await page.waitForURL("**/live-feed");
      await expect(page).toHaveURL(/\/live-feed/);
    }
  });

  test("right panel widgets are visible", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(page.getByText("Daily Briefs")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Active Theses")).toBeVisible();
    await expect(page.getByText("Watchlist")).toBeVisible();
  });
});

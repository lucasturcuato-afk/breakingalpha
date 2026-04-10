import { test, expect } from "@playwright/test";

test.describe("Evening Wrap", () => {
  test("loads evening wrap page", async ({ page }) => {
    await page.goto("/evening-wrap");

    // Should show either wrap content or empty state — scope to heading
    const header = page.getByRole("heading", { name: /Evening/i }).first();
    const empty = page.getByText(/No evening wrap available/);

    await expect(header.or(empty)).toBeVisible({ timeout: 15_000 });
  });

  test("ticker strip renders on evening wrap", async ({ page }) => {
    await page.goto("/evening-wrap");

    // Ticker strip duplicates symbols 3x for animation — just check one
    await expect(page.getByText("SPY").first()).toBeVisible({ timeout: 10_000 });
  });

  test("evening analysis sections render when data exists", async ({ page }) => {
    await page.goto("/evening-wrap");
    await page.waitForTimeout(5_000);

    const sectionHeader = page.getByRole("heading", { name: "Evening Analysis" });
    const empty = page.getByText(/No evening wrap available/);

    // Either we see sections or the empty state — both are valid
    await expect(sectionHeader.or(empty)).toBeVisible({ timeout: 10_000 });
  });

  test("sector signals section renders when data exists", async ({ page }) => {
    await page.goto("/evening-wrap");
    await page.waitForTimeout(5_000);

    const sectorSignals = page.getByRole("heading", { name: "Sector Signals" });
    if (await sectorSignals.isVisible().catch(() => false)) {
      // Sector analysis content should be present (h4 or paragraph)
      const sectorContent = page.locator("main h4, main p").first();
      await expect(sectorContent).toBeVisible();
    }
  });

  test("stories section loads", async ({ page }) => {
    await page.goto("/evening-wrap");
    await page.waitForTimeout(5_000);

    const topStories = page.getByRole("heading", { name: "Today's Top Stories" });
    const empty = page.getByText(/No evening wrap available/);

    // Either stories exist or it's an empty state
    if (await topStories.isVisible().catch(() => false)) {
      // At least one story should render
      const storyCard = page.locator("[class*='rounded-xl']").first();
      await expect(storyCard).toBeVisible();
    }
  });

  test("no error state on evening wrap", async ({ page }) => {
    await page.goto("/evening-wrap");
    await page.waitForTimeout(5_000);

    await expect(page.locator("text=Application error")).not.toBeVisible();
  });
});

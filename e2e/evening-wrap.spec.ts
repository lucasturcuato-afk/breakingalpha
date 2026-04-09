import { test, expect } from "@playwright/test";

test.describe("Evening Wrap", () => {
  test("loads evening wrap page", async ({ page }) => {
    await page.goto("/evening-wrap");

    // Should show either wrap content or empty state
    const header = page.getByText(/Evening/i);
    const empty = page.getByText(/No evening wrap available/);

    await expect(header.or(empty)).toBeVisible({ timeout: 15_000 });
  });

  test("ticker strip renders on evening wrap", async ({ page }) => {
    await page.goto("/evening-wrap");

    const spy = page.getByText("SPY");
    const qqq = page.getByText("QQQ");
    await expect(spy.or(qqq)).toBeVisible({ timeout: 10_000 });
  });

  test("evening analysis sections render when data exists", async ({ page }) => {
    await page.goto("/evening-wrap");
    await page.waitForTimeout(5_000);

    const sectionHeader = page.getByText("Evening Analysis");
    const empty = page.getByText(/No evening wrap available/);

    // Either we see sections or the empty state — both are valid
    await expect(sectionHeader.or(empty)).toBeVisible({ timeout: 10_000 });
  });

  test("sector signals render with filter buttons", async ({ page }) => {
    await page.goto("/evening-wrap");
    await page.waitForTimeout(5_000);

    const sectorSignals = page.getByText("Sector Signals");
    if (await sectorSignals.isVisible().catch(() => false)) {
      // "All" filter button should be present
      const allBtn = page.getByRole("button", { name: "All" });
      await expect(allBtn).toBeVisible();
    }
  });

  test("stories section loads", async ({ page }) => {
    await page.goto("/evening-wrap");
    await page.waitForTimeout(5_000);

    const topStories = page.getByText("Today's Top Stories");
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

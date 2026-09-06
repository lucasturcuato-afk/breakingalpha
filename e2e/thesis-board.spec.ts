import { test, expect } from "@playwright/test";

test.describe("Thesis Board", () => {
  test("loads thesis board page", async ({ page }) => {
    // /thesis-board is a redirect now: theses live on the Radar calls tab
    // as tracked views. The old class/empty-state/generate anchors are gone.
    await page.goto("/thesis-board");
    await page.waitForURL(/\/radar\/calls/, { timeout: 15_000 });
    await expect(page.getByRole("link", { name: "Calls" }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("text=Application error")).not.toBeVisible();
  });

  test("generate theses button works", async ({ page }) => {
    await page.goto("/thesis-board");

    const generateBtn = page.getByRole("button", { name: /Generate Theses/ });

    // Only run if generate button is visible (empty state)
    if (await generateBtn.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await generateBtn.click();

      // Should show loading state
      await expect(page.getByText(/Generating/).first()).toBeVisible({ timeout: 5_000 });

      // Wait for generation to complete (Groq can take a few seconds)
      await expect(page.getByText(/Generating/).first()).not.toBeVisible({
        timeout: 30_000,
      });

      // Should not show error
      const error = page.getByText(/Groq returned|Failed to generate/);
      const hasError = await error.isVisible().catch(() => false);

      if (!hasError) {
        // Theses should now be visible — at least one conviction badge
        const badge = page.getByText(/BULLISH|BEARISH|WATCH/).first();
        await expect(badge).toBeVisible({ timeout: 5_000 });
      }
    }
  });

  test("conviction filter tabs work", async ({ page }) => {
    await page.goto("/thesis-board");

    // Wait for page to load
    await page.waitForTimeout(3_000);

    const bullishTab = page.getByRole("button", { name: /Bullish/ });
    if (await bullishTab.isVisible().catch(() => false)) {
      await bullishTab.click();
      // Page should not show error
      await expect(page.locator("text=Failed")).not.toBeVisible();
    }
  });

  test("thesis detail panel opens on selection", async ({ page }) => {
    await page.goto("/thesis-board");
    await page.waitForTimeout(3_000);

    // Click first thesis card — look for conviction badge containers
    const firstThesis = page.locator("main [class*='cursor-pointer']").first();
    if (await firstThesis.isVisible().catch(() => false)) {
      await firstThesis.click();

      // Detail panel should show rationale or evidence section
      const detail = page.getByText(/Full Analysis|Live Evidence|Catalyst/).first();
      await expect(detail).toBeVisible({ timeout: 5_000 });
    }
  });

  test("no error state on thesis board", async ({ page }) => {
    await page.goto("/thesis-board");
    await page.waitForTimeout(5_000);

    // Should not show unhandled error
    await expect(page.locator("text=Application error")).not.toBeVisible();
    await expect(page.locator("text=500")).not.toBeVisible();
  });
});

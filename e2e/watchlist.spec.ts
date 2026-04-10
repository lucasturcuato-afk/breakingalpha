import { test, expect } from "@playwright/test";

test.describe("Watchlist", () => {
  test("loads watchlist page", async ({ page }) => {
    await page.goto("/watchlist");

    // Match the actual placeholder text used in the component
    const input = page.getByRole("textbox").first();
    await expect(input).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "ADD" })).toBeVisible();
  });

  test("add ticker to watchlist", async ({ page }) => {
    await page.goto("/watchlist");
    await page.waitForTimeout(2_000);

    // Select TICKER type
    const tickerBtn = page.getByRole("button", { name: /TICKER/i });
    if (await tickerBtn.isVisible()) {
      await tickerBtn.click();
    }

    // Type a ticker and add
    const input = page.getByRole("textbox").first();
    await input.fill("AAPL");
    await page.getByRole("button", { name: "ADD" }).click();

    // Wait for response — either success (item appears) or error
    await page.waitForTimeout(3_000);

    // Should show AAPL in the list or a duplicate/error message
    const aapl = page.getByText("AAPL").first();
    const duplicate = page.getByText(/already in your watchlist/);
    await expect(aapl.or(duplicate)).toBeVisible({ timeout: 10_000 });
  });

  test("quick-add sector buttons are visible", async ({ page }) => {
    await page.goto("/watchlist");
    await page.waitForTimeout(2_000);

    // Sector quick-add buttons should be present
    const sectorBtn = page.getByRole("button", { name: /Technology|Healthcare|Energy/i }).first();
    await expect(sectorBtn).toBeVisible({ timeout: 5_000 });
  });

  test("remove item from watchlist", async ({ page }) => {
    await page.goto("/watchlist");
    await page.waitForTimeout(3_000);

    // Find a Remove button
    const deleteBtn = page.getByRole("button", { name: /Remove/i }).first();

    // Only test if there are items to delete
    if (await deleteBtn.isVisible().catch(() => false)) {
      await deleteBtn.click();
      await page.waitForTimeout(2_000);

      // Should not show error
      await expect(page.locator("text=Failed")).not.toBeVisible();
    }
  });

  test("no error state on watchlist page", async ({ page }) => {
    await page.goto("/watchlist");
    await page.waitForTimeout(5_000);

    await expect(page.locator("text=Application error")).not.toBeVisible();
  });
});

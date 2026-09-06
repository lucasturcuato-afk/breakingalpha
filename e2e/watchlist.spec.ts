import { test, expect } from "@playwright/test";
import { removeWatchlistIdentifier } from "./fixtures";

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

    // Start from a state without AAPL so the add is a real add, and remove
    // it afterwards so the next run starts the same way (e2e/fixtures.ts).
    await removeWatchlistIdentifier(page, "AAPL");
    await page.reload();
    await page.waitForTimeout(1_000);

    // Type a ticker and PICK it. ADD stays disabled on the ticker tab until a
    // suggestion is selected (WatchlistAddInput: `addType === "ticker" &&
    // !selectedTicker`); typing alone never enables it. That is the control's
    // design, not a defect, and the old fill-then-click flow was stale.
    const input = page.getByRole("textbox").first();
    await input.fill("AAPL");
    const exact = page.getByRole("button", { name: /^AAPL\b(?!\.)/ }).first();
    const any = page.getByRole("button", { name: /^AAPL\b/ }).first();
    await expect(any).toBeVisible({ timeout: 10_000 });
    if (await exact.isVisible().catch(() => false)) await exact.click();
    else await any.click();
    const add = page.getByRole("button", { name: "ADD" });
    await expect(add).toBeEnabled();
    await add.click();

    // Should show AAPL in the list or a duplicate/error message
    const aapl = page.getByText(/AAPL/).first();
    const duplicate = page.getByText(/already in your watchlist/);
    await expect(aapl.or(duplicate)).toBeVisible({ timeout: 10_000 });
    await removeWatchlistIdentifier(page, "AAPL");
  });

  test("quick-add sector buttons are visible", async ({ page }) => {
    await page.goto("/watchlist");
    await page.waitForTimeout(2_000);

    // Sector quick-add buttons should be present
    // The quick-select chips render only on the Sector tab with an empty
    // query; the default tab is Ticker.
    await page.getByRole("button", { name: /^Sector$/i }).click();
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

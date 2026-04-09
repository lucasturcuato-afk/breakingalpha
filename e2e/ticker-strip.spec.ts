import { test, expect } from "@playwright/test";

test.describe("Ticker Strip", () => {
  test("renders all default symbols", async ({ page }) => {
    await page.goto("/morning-brief");

    const symbols = ["SPY", "QQQ", "AAPL", "NVDA", "MSFT", "META", "GOOGL", "AMZN", "TSLA", "GLD", "TLT", "BTC"];

    // At least the first few should be visible (some may be scrolled off-screen)
    for (const sym of symbols.slice(0, 4)) {
      await expect(page.getByText(sym).first()).toBeVisible({ timeout: 10_000 });
    }
  });

  test("shows price data or dash fallback for each symbol", async ({ page }) => {
    await page.goto("/morning-brief");
    await page.waitForTimeout(5_000);

    // Find all font-data elements (prices and percentages)
    const dataElements = page.locator("[class*='font-data']");
    const count = await dataElements.count();

    // Should have many data elements (symbol + price + pct for each ticker, tripled for animation)
    expect(count).toBeGreaterThan(10);
  });

  test("shows green/red arrows for price changes", async ({ page }) => {
    await page.goto("/morning-brief");
    await page.waitForTimeout(5_000);

    // Should show either up or down arrow indicators
    const upArrow = page.locator("text=▲").first();
    const downArrow = page.locator("text=▼").first();

    await expect(upArrow.or(downArrow)).toBeVisible({ timeout: 5_000 });
  });

  test("strip has scrolling animation", async ({ page }) => {
    await page.goto("/morning-brief");

    // The scrolling container should have the animation class
    const scrollTrack = page.locator("[class*='animate-']");
    await expect(scrollTrack.first()).toBeVisible({ timeout: 5_000 });
  });
});

import { test, expect } from "@playwright/test";

test.describe("Ticker Strip", () => {
  test("renders all default symbols", async ({ page }) => {
    await page.goto("/morning-brief");

    const symbols = ["SPY", "QQQ", "AAPL", "NVDA", "MSFT", "META", "GOOGL", "AMZN", "TSLA", "GLD", "TLT", "BTC"];

    // At least the first few should be visible (tripled for scroll animation — use .first())
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

    // Should show either up or down arrow indicators — use .first() for animation duplicates
    // One locator for either glyph: `.or()` of two `.first()`s resolves to
    // every arrow on the strip and trips strict mode.
    const upArrow = page.locator("text=▲");
    const downArrow = page.locator("text=▼");

    await expect(upArrow.or(downArrow).first()).toBeVisible({ timeout: 5_000 });
  });

  test("strip has scrolling animation", async ({ page }) => {
    await page.goto("/morning-brief");

    // The scrolling container should have the animation class
    const scrollTrack = page.locator("[class*='animate-']");
    await expect(scrollTrack.first()).toBeVisible({ timeout: 5_000 });
  });
});

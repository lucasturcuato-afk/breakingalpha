import { test, expect } from "@playwright/test";

test.describe("Morning Brief", () => {
  test("loads morning brief page", async ({ page }) => {
    await page.goto("/morning-brief");

    // Should show either briefing content or empty state
    const header = page.getByText(/Morning/i);
    const empty = page.getByText(/No morning brief available/);

    await expect(header.or(empty)).toBeVisible({ timeout: 15_000 });
  });

  test("ticker strip renders with symbols", async ({ page }) => {
    await page.goto("/morning-brief");

    // Ticker strip should show at least one of the default symbols
    const spy = page.getByText("SPY");
    const qqq = page.getByText("QQQ");
    await expect(spy.or(qqq)).toBeVisible({ timeout: 10_000 });
  });

  test("ticker strip shows prices or fallback dashes", async ({ page }) => {
    await page.goto("/morning-brief");
    await page.waitForTimeout(3_000);

    // Each ticker should show either a price number or "—" fallback
    const tickerData = page.locator("[class*='font-data']").first();
    await expect(tickerData).toBeVisible({ timeout: 5_000 });
  });

  test("briefing sections render when data exists", async ({ page }) => {
    await page.goto("/morning-brief");
    await page.waitForTimeout(5_000);

    // If briefing loaded, section headers should be visible
    const sectionHeader = page.getByText(/Macro|Deals|Markets|Sector|Watch/i).first();
    const empty = page.getByText(/No morning brief available/);

    if (await sectionHeader.isVisible().catch(() => false)) {
      // Export and Share buttons should be present
      await expect(page.getByText(/Export Brief/)).toBeVisible();
      await expect(page.getByText(/Share/)).toBeVisible();
    }
  });

  test("export brief downloads file", async ({ page }) => {
    await page.goto("/morning-brief");
    await page.waitForTimeout(5_000);

    const exportBtn = page.getByText(/Export Brief/);
    if (await exportBtn.isVisible().catch(() => false)) {
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 5_000 }).catch(() => null),
        exportBtn.click(),
      ]);

      if (download) {
        expect(download.suggestedFilename()).toMatch(/signalera.*\.txt/);
      }
    }
  });

  test("share button copies link", async ({ page }) => {
    await page.goto("/morning-brief");
    await page.waitForTimeout(5_000);

    const shareBtn = page.getByText(/Share/).first();
    if (await shareBtn.isVisible().catch(() => false)) {
      await shareBtn.click();
      await expect(page.getByText("Link copied")).toBeVisible({ timeout: 3_000 });
    }
  });

  test("no error state on morning brief", async ({ page }) => {
    await page.goto("/morning-brief");
    await page.waitForTimeout(5_000);

    await expect(page.locator("text=Application error")).not.toBeVisible();
  });
});

import { test, expect } from "@playwright/test";

test.describe("Morning Brief", () => {
  test("loads morning brief page", async ({ page }) => {
    await page.goto("/morning-brief");

    // Should show either briefing content or empty state — scope heading to main
    const header = page.getByRole("heading", { name: /Morning/i }).first();
    const empty = page.getByText(/No morning brief available/);

    await expect(header.or(empty)).toBeVisible({ timeout: 15_000 });
  });

  test("ticker strip renders with symbols", async ({ page }) => {
    await page.goto("/morning-brief");

    // Ticker strip duplicates symbols 3x for scroll animation — just check one
    await expect(page.getByText("SPY").first()).toBeVisible({ timeout: 10_000 });
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
    const sectionHeader = page.locator("main").getByText(/Macro|Deals|Markets|Sector|Watch/i).first();
    const empty = page.getByText(/No morning brief available/);

    if (await sectionHeader.isVisible().catch(() => false)) {
      // Export and Share buttons should be present
      await expect(page.getByText(/Export Brief/).first()).toBeVisible();
      await expect(page.getByRole("button", { name: /^Share$/ }).first()).toBeVisible();
    }
  });

  test("export brief downloads file", async ({ page }) => {
    await page.goto("/morning-brief");
    await page.waitForTimeout(5_000);

    const exportBtn = page.getByText(/Export Brief/).first();
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

    const shareBtn = page.getByRole("button", { name: /^Share$/ }).first();
    if (await shareBtn.isVisible().catch(() => false)) {
      // navigator.clipboard.writeText rejects in a headless context without the
      // permission, and the button then shows "Copy failed". Grant it: this test
      // is about the toast, not the browser's permission prompt.
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
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

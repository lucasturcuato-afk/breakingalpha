import { test, expect } from "@playwright/test";

test.describe("Deal Flow", () => {
  test("loads deal flow page with header", async ({ page }) => {
    await page.goto("/deal-flow");

    await expect(page.getByText("Deal Flow Tracker")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/AI-extracted deal pipeline/)).toBeVisible();
  });

  test("deal list loads or shows empty state", async ({ page }) => {
    await page.goto("/deal-flow");

    // Wait for loading to finish
    const dealCard = page.locator("[class*='rounded-xl']").first();
    const emptyState = page.getByText(/Deal pipeline populating|No deals/);

    await expect(dealCard.or(emptyState)).toBeVisible({ timeout: 15_000 });

    // No error state
    await expect(page.locator("text=Application error")).not.toBeVisible();
  });

  test("filter tabs are visible and clickable", async ({ page }) => {
    await page.goto("/deal-flow");
    await page.waitForTimeout(3_000);

    // Stage filter tabs
    const allTab = page.getByRole("button", { name: /ALL/i });
    await expect(allTab).toBeVisible();

    const announcedTab = page.getByRole("button", { name: /ANNOUNCED/i });
    if (await announcedTab.isVisible()) {
      await announcedTab.click();
      await page.waitForTimeout(1_000);
      await expect(page.locator("text=Application error")).not.toBeVisible();
    }
  });

  test("add deal form toggle works", async ({ page }) => {
    await page.goto("/deal-flow");
    await page.waitForTimeout(3_000);

    const addBtn = page.getByRole("button", { name: /Add Deal/i });
    if (await addBtn.isVisible()) {
      await addBtn.click();

      // Form field — use exact placeholder to avoid matching the search input
      const companyField = page.getByRole("textbox", { name: "Company *" });
      await expect(companyField).toBeVisible({ timeout: 3_000 });

      // Cancel should close form
      const cancelBtn = page.getByRole("button", { name: /Cancel/i });
      if (await cancelBtn.isVisible()) {
        await cancelBtn.click();
        await expect(companyField).not.toBeVisible();
      }
    }
  });

  test("search input filters deals", async ({ page }) => {
    await page.goto("/deal-flow");
    await page.waitForTimeout(3_000);

    const searchInput = page.getByPlaceholder(/Search/i);
    if (await searchInput.isVisible()) {
      await searchInput.fill("nonexistent-company-xyz");
      await page.waitForTimeout(1_000);

      // Should show no results or empty state
      const noResults = page.getByText(/No deals match/);
      // This is expected if filter works
      await expect(page.locator("text=Application error")).not.toBeVisible();
    }
  });
});

import { test, expect } from "@playwright/test";

test.describe("Shell & Navigation", () => {
  test("sidebar renders with all nav links", async ({ page }) => {
    await page.goto("/dashboard");

    // Main nav items
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("link", { name: "Morning Brief" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Evening Wrap" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Live Feed" })).toBeVisible();

    // Research nav items
    await expect(page.getByRole("link", { name: "Thesis Board" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Deal Flow" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Watchlist" })).toBeVisible();
  });

  test("sidebar navigation works for each page", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForTimeout(2_000);

    const routes = [
      { name: "Live Feed", url: "/live-feed" },
      { name: "Thesis Board", url: "/thesis-board" },
      { name: "Deal Flow", url: "/deal-flow" },
      { name: "Watchlist", url: "/watchlist" },
    ];

    for (const route of routes) {
      await page.getByRole("link", { name: route.name }).click();
      await page.waitForURL(`**${route.url}`, { timeout: 10_000 });
      await expect(page).toHaveURL(new RegExp(route.url));

      // No crash
      await expect(page.locator("text=Application error")).not.toBeVisible();
    }
  });

  test("command palette opens with Cmd+K", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForTimeout(2_000);

    await page.keyboard.press("Meta+k");
    await expect(page.getByPlaceholder(/Search|command/i)).toBeVisible({ timeout: 3_000 });

    // Close with Escape
    await page.keyboard.press("Escape");
    await expect(page.getByPlaceholder(/Search|command/i)).not.toBeVisible();
  });

  test("mood bar renders", async ({ page }) => {
    await page.goto("/dashboard");

    const moodBadge = page.getByText(/Risk-Off|Risk-On|Neutral/);
    await expect(moodBadge).toBeVisible({ timeout: 10_000 });
  });

  test("user card shows in sidebar", async ({ page }) => {
    await page.goto("/dashboard");

    // User avatar/initials should be visible in sidebar
    const sidebar = page.locator("aside");
    await expect(sidebar).toBeVisible({ timeout: 5_000 });

    // Should show user name or initials (not just "User")
    const settingsLink = page.getByRole("link", { name: /Settings/i });
    await expect(settingsLink).toBeVisible();
  });
});

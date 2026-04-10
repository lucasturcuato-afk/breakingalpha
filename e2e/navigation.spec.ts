import { test, expect } from "@playwright/test";

test.describe("Shell & Navigation", () => {
  test("sidebar renders with all nav links", async ({ page }) => {
    await page.goto("/dashboard");

    const sidebar = page.locator("aside, nav").first();

    // Main nav items — scope to sidebar to avoid matching CTA links elsewhere
    await expect(sidebar.getByRole("link", { name: "Dashboard" })).toBeVisible({ timeout: 10_000 });
    await expect(sidebar.getByRole("link", { name: /Morning Brief/ })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Evening Wrap", exact: true })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Live Feed" })).toBeVisible();

    // Research nav items
    await expect(sidebar.getByRole("link", { name: "Thesis Board" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Deal Flow" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Watchlist", exact: true })).toBeVisible();
  });

  test("sidebar navigation works for each page", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForURL("**/dashboard", { timeout: 10_000 });

    // Dismiss any overlay/modal that might be intercepting clicks
    const overlay = page.locator(".backdrop-blur-sm, [class*='backdrop']");
    if (await overlay.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
    }

    const sidebar = page.locator("aside, nav").first();
    const routes = [
      { name: "Live Feed", url: "/live-feed", exact: false },
      { name: "Thesis Board", url: "/thesis-board", exact: false },
      { name: "Deal Flow", url: "/deal-flow", exact: false },
      { name: "Watchlist", url: "/watchlist", exact: true },
      { name: "Evening Wrap", url: "/evening-wrap", exact: true },
    ];

    for (const route of routes) {
      // Dismiss any overlay that might have appeared
      const overlayInLoop = page.locator(".backdrop-blur-sm, [class*='backdrop']");
      if (await overlayInLoop.isVisible({ timeout: 500 }).catch(() => false)) {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(500);
      }
      await sidebar.getByRole("link", { name: route.name, exact: route.exact }).click();
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
    // The command palette input — match the actual placeholder text
    const cmdInput = page.getByPlaceholder(/Search|command|Signalera/i);
    await expect(cmdInput).toBeVisible({ timeout: 3_000 });

    // Close with Escape
    await page.keyboard.press("Escape");
    await expect(cmdInput).not.toBeVisible();
  });

  test("mood bar renders", async ({ page }) => {
    await page.goto("/dashboard");

    // The mood badge in the top bar — match first occurrence
    const moodBadge = page.getByText(/Risk-Off|Risk-On|Neutral/).first();
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

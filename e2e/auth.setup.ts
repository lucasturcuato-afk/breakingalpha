import { test as setup, expect } from "@playwright/test";
import path from "path";

const AUTH_FILE = path.join(__dirname, ".auth", "user.json");

/**
 * Authenticate once, save storage state for all tests.
 *
 * Requires env vars:
 *   E2E_USER_EMAIL    — test account email
 *   E2E_USER_PASSWORD — test account password
 */
setup("authenticate", async ({ page }) => {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "E2E_USER_EMAIL and E2E_USER_PASSWORD must be set in .env.local or environment",
    );
  }

  await page.goto("/auth");

  // Wait for auth page to load — use the submit button inside the form
  await expect(page.locator("form").getByRole("button", { name: "Sign In" })).toBeVisible();

  // Fill credentials
  await page.getByPlaceholder("Email address").fill(email);
  await page.getByPlaceholder("Password").fill(password);

  // Submit via the form button (not the tab toggle)
  await page.locator("form").getByRole("button", { name: "Sign In" }).click();

  // Wait for redirect to dashboard
  await page.waitForURL("**/dashboard", { timeout: 15_000 });
  await expect(page).toHaveURL(/\/dashboard/);

  // Save authenticated state
  await page.context().storageState({ path: AUTH_FILE });
});

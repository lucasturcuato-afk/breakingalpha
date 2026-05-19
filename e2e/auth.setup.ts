import { test as setup } from "@playwright/test";
import path from "path";
import { signIn } from "./auth-helper";

const AUTH_FILE = path.join(__dirname, ".auth", "user.json");

/**
 * Authenticate once, save storage state for all tests in the chromium project.
 *
 * Requires env vars:
 *   E2E_USER_EMAIL    — test account email
 *   E2E_USER_PASSWORD — test account password
 *   E2E_BASE_URL      — optional; if unset, uses page baseURL from playwright.config.ts
 */
setup("authenticate", async ({ page }) => {
  await signIn(page);
  await page.context().storageState({ path: AUTH_FILE });
});

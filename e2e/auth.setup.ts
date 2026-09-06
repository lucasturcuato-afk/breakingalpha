import { test as setup } from "@playwright/test";
import path from "path";
import { signIn } from "./auth-helper";
import { assertServerIsThisCheckout } from "./server-identity";

const AUTH_FILE = path.join(__dirname, ".auth", "user.json");

/**
 * Authenticate once, save storage state for all tests in the chromium project.
 *
 * Requires env vars:
 *   E2E_USER_EMAIL    — test account email
 *   E2E_USER_PASSWORD — test account password
 *   E2E_BASE_URL      — optional; if unset, uses page baseURL from playwright.config.ts
 */
setup("the server on the port is this checkout", async ({ baseURL }) => {
  // Runs before authenticate (same file, declaration order) and before every
  // chromium spec (project dependency). A foreign or stale server is an
  // error here, with both identities in the message, never a silent reuse.
  await assertServerIsThisCheckout(baseURL ?? "http://localhost:3000", { expectNodeEnv: "development" });
});

setup("authenticate", async ({ page }) => {
  await signIn(page);
  await page.context().storageState({ path: AUTH_FILE });
});

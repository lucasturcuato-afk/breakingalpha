import { test, expect } from "@playwright/test";
import { signIn, signInAndGo, getTestCredentials } from "./auth-helper";

/**
 * Validates the auth-helper module against the live prod signalera.ai site.
 *
 * Run with:
 *   set -a && source .env.playwright && set +a
 *   npx playwright test auth-smoke.spec.ts --reporter=list
 *
 * Routed to the "smoke-prod" project in playwright.config.ts, which has no
 * setup-project dependency and no preloaded storage state — each test signs
 * in fresh.
 */
test.describe("Auth helper smoke (prod)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("signIn lands on /dashboard with authenticated UI", async ({ page }) => {
    await signIn(page);

    const { baseUrl } = getTestCredentials();
    expect(page.url()).toBe(`${baseUrl}/dashboard`);

    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator("aside, [role='complementary']").first()).toBeVisible();
  });

  test("signInAndGo('/company/nvidia') renders the NVIDIA company page", async ({ page }) => {
    await signInAndGo(page, "/company/nvidia");

    const { baseUrl } = getTestCredentials();
    expect(page.url()).toBe(`${baseUrl}/company/nvidia`);
    await expect(page).toHaveTitle(/NVIDIA/i, { timeout: 10_000 });
  });

  test("signInAndGo('/morning-brief') renders the briefing page", async ({ page }) => {
    await signInAndGo(page, "/morning-brief");

    const { baseUrl } = getTestCredentials();
    expect(page.url()).toBe(`${baseUrl}/morning-brief`);
    await expect(page.getByRole("heading", { name: /Morning Brief/i, level: 1 })).toBeVisible({
      timeout: 15_000,
    });
  });
});

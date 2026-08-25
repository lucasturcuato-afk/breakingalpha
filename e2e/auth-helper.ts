import { expect, type Page } from "@playwright/test";

export interface TestCredentials {
  email: string;
  password: string;
  baseUrl: string;
}

function readEnv(): { email?: string; password?: string; baseUrl?: string } {
  return {
    email: process.env.E2E_USER_EMAIL,
    password: process.env.E2E_USER_PASSWORD,
    baseUrl: process.env.E2E_BASE_URL?.replace(/\/$/, ""),
  };
}

export function getTestCredentials(): TestCredentials {
  const { email, password, baseUrl } = readEnv();
  const missing: string[] = [];
  if (!email) missing.push("E2E_USER_EMAIL");
  if (!password) missing.push("E2E_USER_PASSWORD");
  if (!baseUrl) missing.push("E2E_BASE_URL");

  if (missing.length > 0) {
    throw new Error(
      `Missing required env vars: ${missing.join(", ")}. ` +
        `Run: \`set -a && source .env.playwright && set +a\` before invoking Playwright.`,
    );
  }

  return { email: email!, password: password!, baseUrl: baseUrl! };
}

export async function signIn(page: Page): Promise<void> {
  const { email, password, baseUrl } = readEnv();

  if (!email || !password) {
    throw new Error(
      "signIn() requires E2E_USER_EMAIL and E2E_USER_PASSWORD. " +
        "Source .env.playwright (prod) or add to .env.local (local dev) before running Playwright.",
    );
  }

  await page.goto(baseUrl ? `${baseUrl}/auth` : "/auth");

  /* Scope every field to the VISIBLE form, and that is load-bearing.
   *
   * `/auth` always has TWO forms in the DOM at every viewport: `MobileAuth` is
   * mounted unconditionally, and the desktop form is hidden with a CSS class
   * (`hidden md:flex`, src/app/auth/page.tsx:178) rather than unmounted. So a
   * page-level `getByPlaceholder("Email address")` resolves to 2 elements and
   * Playwright's strict mode throws before a single character is typed.
   *
   * That took out the `setup` project, and because the chromium project
   * depends on `setup`, it took out the whole suite: the repo could not
   * authenticate as written. Two agents hit it independently on separate
   * branches before anyone read this file.
   *
   * `form:visible` is Playwright's own pseudo-class, so this keeps working
   * whichever form is the visible one at the current viewport. */
  const form = page.locator("form:visible").first();

  const submitButton = form.getByRole("button", { name: "Sign In" });
  await expect(submitButton).toBeVisible({ timeout: 10_000 });

  await form.getByPlaceholder("Email address").fill(email);
  await form.getByPlaceholder("Password").fill(password);
  await submitButton.click();

  try {
    await page.waitForURL("**/dashboard", { timeout: 15_000 });
  } catch (err) {
    const landedAt = page.url();
    const inlineError = await page
      .locator(".text-signal-dn")
      .first()
      .textContent()
      .catch(() => null);

    throw new Error(
      `signIn() failed: expected to land on /dashboard, got ${landedAt}. ` +
        (inlineError ? `Inline error: "${inlineError.trim()}". ` : "") +
        `If sign-in succeeded but redirected elsewhere, the Supabase Site URL may still ` +
        `point to a stale domain (see HANDOFF.md "OAuth auth redirect broken after domain migration"). ` +
        `Original error: ${(err as Error).message}`,
    );
  }
}

export async function signInAndGo(page: Page, path: string): Promise<void> {
  await signIn(page);
  const { baseUrl } = readEnv();
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const target = path.startsWith("http") ? path : baseUrl ? `${baseUrl}${normalized}` : normalized;
  await page.goto(target);
}

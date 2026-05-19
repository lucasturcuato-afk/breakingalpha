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

  const submitButton = page.locator("form").getByRole("button", { name: "Sign In" });
  await expect(submitButton).toBeVisible({ timeout: 10_000 });

  await page.getByPlaceholder("Email address").fill(email);
  await page.getByPlaceholder("Password").fill(password);
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

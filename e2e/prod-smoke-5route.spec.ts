import { test, expect, type Page } from "@playwright/test";
import { signIn, getTestCredentials } from "./auth-helper";
import fs from "fs";
import path from "path";

/**
 * 5-route prod smoke audit against signalera.ai.
 *
 * Run with:
 *   set -a && source .env.playwright && set +a
 *   npx playwright test prod-smoke-5route.spec.ts --reporter=list
 *
 * Routed to the "smoke-prod" project in playwright.config.ts (no setup-project
 * dependency, no preloaded storage state). Each test signs in fresh, navigates
 * to the target route, captures full-page screenshot, console errors, and
 * network failures, then writes per-route JSON findings to e2e/screenshots/
 * prod-smoke/<slug>.findings.json. The final `summary` test aggregates them.
 *
 * Baseline run for W2-D Thread E (full 180-surface sweep). DO NOT take
 * destructive actions — read-only navigation + screenshot only.
 */

interface NetworkFailure {
  url: string;
  status: number;
}

interface RouteFindings {
  route: string;
  slug: string;
  finalUrl: string;
  redirectedToAuth: boolean;
  sidebarVisible: boolean;
  userAvatarVisible: boolean;
  headingVisible: boolean;
  consoleErrors: string[];
  networkFailures: NetworkFailure[];
  rawTokenLeaks: string[];
  screenshotPath: string;
  durationMs: number;
  loadError: string | null;
}

const SCREENSHOT_DIR = path.join(__dirname, "screenshots", "prod-smoke");
const FINDINGS_DIR = SCREENSHOT_DIR;

function slugify(route: string): string {
  return route.replace(/^\//, "").replace(/\//g, "-") || "root";
}

async function auditRoute(page: Page, route: string): Promise<RouteFindings> {
  const slug = slugify(route);
  // Per-route arrays, declared fresh here so prior-route entries cannot leak
  // (each test gets its own Page anyway, but keep the contract explicit).
  const consoleErrors: string[] = [];
  const networkFailures: NetworkFailure[] = [];

  const start = Date.now();
  let loadError: string | null = null;

  // Sign in BEFORE installing the network/console listeners. Otherwise the
  // pre-auth /api/user-profile ping fired from /auth (a guaranteed 401 prior
  // to the WD124 provider gate) gets mis-attributed to whichever route is
  // currently under test, producing a phantom "401 on every route" pattern.
  await signIn(page);

  // Listeners scoped to THIS audit only — installed after sign-in and removed
  // before the function returns so they cannot bleed into the next route.
  const onConsole = (msg: import("@playwright/test").ConsoleMessage) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  };
  const onResponse = (response: import("@playwright/test").Response) => {
    if (response.status() >= 400) {
      networkFailures.push({ url: response.url(), status: response.status() });
    }
  };
  page.on("console", onConsole);
  page.on("response", onResponse);

  const { baseUrl } = getTestCredentials();
  try {
    await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle", timeout: 25_000 });
  } catch (err) {
    loadError = `goto failed: ${(err as Error).message}`;
    // continue — we still want screenshot + assertions
  }

  // Allow late-arriving renders
  await page.waitForTimeout(2_000);

  const screenshotPath = path.join(SCREENSHOT_DIR, `${slug}.png`);
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
  } catch (err) {
    loadError = (loadError ? loadError + "; " : "") + `screenshot failed: ${(err as Error).message}`;
  }

  const finalUrl = page.url();
  const redirectedToAuth = /\/auth(\?|$|\/)/.test(finalUrl);

  // Sidebar present
  const sidebarVisible = await page
    .locator("aside, [role='complementary']")
    .first()
    .isVisible()
    .catch(() => false);

  // User avatar / menu — look for ".C" initial or the user-menu button
  const userAvatarVisible = await page
    .locator(
      "button:has-text('C'), [aria-label*='user' i], [aria-label*='account' i], button[aria-haspopup='menu']",
    )
    .first()
    .isVisible()
    .catch(() => false);

  // Any visible h1
  const headingVisible = await page
    .locator("h1")
    .first()
    .isVisible()
    .catch(() => false);

  // Scan rendered text for raw CSS token leaks like var(--gold-deep)
  const rawTokenLeaks: string[] = [];
  try {
    const bodyText = await page.locator("body").innerText({ timeout: 5_000 });
    const matches = bodyText.match(/var\(--[a-z0-9-]+\)/gi);
    if (matches) {
      rawTokenLeaks.push(...Array.from(new Set(matches)));
    }
  } catch {
    /* ignore */
  }

  const findings: RouteFindings = {
    route,
    slug,
    finalUrl,
    redirectedToAuth,
    sidebarVisible,
    userAvatarVisible,
    headingVisible,
    consoleErrors,
    networkFailures,
    rawTokenLeaks,
    screenshotPath,
    durationMs: Date.now() - start,
    loadError,
  };

  fs.mkdirSync(FINDINGS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(FINDINGS_DIR, `${slug}.findings.json`),
    JSON.stringify(findings, null, 2),
  );

  // Detach listeners so the next test/route starts with a clean slate.
  page.off("console", onConsole);
  page.off("response", onResponse);

  return findings;
}

test.describe("Prod smoke 5-route audit (W2-D Thread E baseline)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  const routes = ["/dashboard", "/company/nvidia", "/morning-brief", "/evening-wrap", "/watchlist"];

  for (const route of routes) {
    test(`audits ${route}`, async ({ page }) => {
      const findings = await auditRoute(page, route);

      // Hard fail only on CRITICAL conditions — collect everything else.
      expect(findings.redirectedToAuth, `Route ${route} redirected to /auth`).toBe(false);

      // Soft signal — log but do not fail — sidebar + avatar
      // (some routes may legitimately render without sidebar; collect & report)
      if (!findings.sidebarVisible) {
        console.warn(`[soft] ${route}: sidebar not visible`);
      }
      if (!findings.userAvatarVisible) {
        console.warn(`[soft] ${route}: user avatar not visible`);
      }
      if (findings.rawTokenLeaks.length > 0) {
        console.warn(`[soft] ${route}: raw CSS token leaks: ${findings.rawTokenLeaks.join(", ")}`);
      }
    });
  }
});

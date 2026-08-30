/**
 * The environment the walk runs in, and the guards that keep it honest.
 *
 * TARGET. A LOCAL PRODUCTION BUILD (`next build` then `next start`) on port
 * 3370, started with `VERCEL_ENV=preview` and nothing else. That combination is
 * deliberate and is the only one that measures the right thing:
 *
 *   - `next start` means NODE_ENV=production, so `mobileFixtureScreensEnabled()`
 *     is false and no screen serves its fixture. A dev server serves the
 *     fixtures, and a walk on a dev server reports invented data as live.
 *   - `VERCEL_ENV=preview` (UNPREFIXED) is what `isMobileRedesignDevPath` in
 *     src/proxy.ts reads. It opens the mobile routes as public paths, which is
 *     what gets past the beta_allowlist gate at proxy.ts:160 for an account
 *     that is not on the allowlist.
 *   - `NEXT_PUBLIC_VERCEL_ENV` is deliberately NOT set. Setting it would flip
 *     the fixture gate on the server only (the client bundle was compiled
 *     without it), which is a hydration mismatch dressed up as a test target.
 */
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import path from "path";
import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: path.resolve(__dirname, "../../../.env.local") });

export const BASE = process.env.PRESSURE_BASE_URL ?? "http://localhost:3370";
export const AUTH_STATE = path.resolve(__dirname, "../../.auth/pressure.json");

export type Theme = "light" | "dark";

/** Every API route in this repo that reaches Gemini, plus the one with a quota. */
export const GEMINI_ROUTES = [
  "/api/intelligence",
  "/api/memo",
  "/api/company-overview",
  "/api/financials-commentary",
  "/api/onboarding/preview-thesis",
  "/api/radar/claims/author",
  "/api/theses",
  "/api/theses/backfill-tickers",
  "/api/thesis-detail",
  "/api/thesis-regenerate",
];

/**
 * Guard 1: nothing reaches POST /api/intelligence, ever.
 *
 * Two models, fifteen a day, and the limiter is consumed BEFORE the cache
 * check, so even a cache hit costs one. The canned body carries an
 * `output_id`, which is what the feedback row on the screen needs in order to
 * render at all; without it the screen under test is a different screen.
 *
 * Guard 2: no OTHER Gemini-backed route is reached either. The prompt forbids
 * calling Gemini, not just that one route, and `/api/radar/claims/author` calls
 * gemini-2.5-pro on every request.
 *
 * Guard 3 (walk phases only): no mutating request reaches any API. The empty
 * walk taps every control on every screen, and some of those controls write.
 * Blocking non-GET during the walk keeps the empty pass genuinely read-only
 * AND turns each blocked attempt into a record of which control writes.
 */
export interface GuardState {
  blockMutations: boolean;
  blockedMutations: string[];
  geminiAttempts: string[];
  intelligenceAttempts: number;
  externalAborted: string[];
}

export async function installGuards(context: BrowserContext): Promise<GuardState> {
  const state: GuardState = {
    blockMutations: true,
    blockedMutations: [],
    geminiAttempts: [],
    intelligenceAttempts: 0,
    externalAborted: [],
  };

  await context.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const pathname = url.pathname;
    const method = req.method();

    if (pathname === "/api/intelligence") {
      state.intelligenceAttempts += 1;
      state.geminiAttempts.push(`${method} ${pathname}`);
      /* Canned, with an output_id, so the feedback control renders. */
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          output_id: "pressure-harness-fake-output-id",
          answer:
            "Canned harness answer. The desk read is intercepted so no model is called and no daily allowance is consumed.",
          response: "Canned harness answer.",
          sources: [],
          citations: [],
          cached: false,
        }),
      });
    }

    if (GEMINI_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"))) {
      state.geminiAttempts.push(`${method} ${pathname}`);
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "blocked by pressure harness: this route calls Gemini" }),
      });
    }

    if (state.blockMutations && method !== "GET" && method !== "HEAD") {
      state.blockedMutations.push(`${method} ${pathname}`);
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "blocked by pressure harness: read-only walk phase" }),
      });
    }

    return route.continue();
  });

  /**
   * Nothing leaves the machine EXCEPT Supabase.
   *
   * Supabase is not optional: the sign-in form posts to its auth endpoint and
   * several client components read through it directly, so aborting that origin
   * would mean walking a signed-out app and reporting its loading failures as
   * defects. It is allowed, and its WRITE surface (`/rest/v1/`) is held to the
   * same read-only rule the app's own API is, so a control that writes straight
   * past `/api/` cannot slip through the walk unrecorded.
   *
   * Everything else external is aborted: no Finnhub quota, no font fetch, no
   * telemetry. An aborted third-party request can make a screen render its
   * failure state, so each one is recorded rather than silently dropped.
   */
  const supabaseOrigin = (() => {
    try {
      return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
    } catch {
      return "";
    }
  })();

  await context.route(/^https?:\/\//, (route) => {
    const req = route.request();
    const u = req.url();
    const origin = new URL(u).origin;
    if (origin === "http://localhost:3370" || origin === BASE) return route.fallback();
    if (supabaseOrigin && origin === supabaseOrigin) {
      const p = new URL(u).pathname;
      if (state.blockMutations && p.startsWith("/rest/v1/") && !["GET", "HEAD"].includes(req.method())) {
        state.blockedMutations.push(`${req.method()} supabase${p}`);
        return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "blocked by pressure harness" }) });
      }
      return route.continue();
    }
    state.externalAborted.push(`${req.method()} ${origin}${new URL(u).pathname}`);
    return route.abort();
  });

  return state;
}

export async function launch(): Promise<Browser> {
  return chromium.launch();
}

/**
 * A phone context.
 *
 * `hasTouch` is on the CONTEXT and it is what flips `hover: none` and
 * `any-hover: none`. `Emulation.setEmulatedMedia` alone does not, which is the
 * trap that makes a hover-state audit read as if the phone had a mouse.
 * `assertEmulation` below proves it landed rather than assuming it.
 */
export async function phoneContext(browser: Browser, theme: Theme, storageState?: string): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    baseURL: BASE,
    storageState,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  /* Theme is localStorage, read by the provider before paint. `emulateMedia`
     does nothing for it, and a run that relies on emulateMedia captures light
     twice and reports it as a theme pass. */
  await ctx.addInitScript((t) => {
    try {
      window.localStorage.setItem("signalera_theme", t as string);
    } catch {
      /* storage unavailable on about:blank in some contexts */
    }
  }, theme);
  return ctx;
}

export async function assertEmulation(page: Page): Promise<{ anyHoverNone: boolean; touch: boolean; width: number }> {
  return page.evaluate(() => ({
    anyHoverNone: window.matchMedia("(any-hover: none)").matches,
    touch: "ontouchstart" in window || navigator.maxTouchPoints > 0,
    width: window.innerWidth,
  }));
}

/**
 * A genuine cold entry.
 *
 * `newPage()` starts on about:blank, so `page.goto` PUSHES and history.length
 * is 2 on arrival. Any screen whose back control branches on history depth then
 * measures a history the reader could not have. `location.replace` from
 * about:blank replaces that entry instead of adding one.
 */
export async function coldGoto(page: Page, url: string): Promise<number> {
  const target = url.startsWith("http") ? url : BASE + url;
  await page.goto("about:blank");
  await Promise.all([
    page.waitForURL((u) => u.toString().startsWith(target), { timeout: 20_000 }),
    page.evaluate((u) => {
      window.location.replace(u as string);
    }, target),
  ]);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(400);
  return page.evaluate(() => window.history.length);
}

/**
 * Navigate and WAIT FOR THE SCREEN TO SETTLE.
 *
 * `/dashboard` opens on an entrance ladder ("READING OVERNIGHT COVERAGE") and
 * several screens fetch after mount. Measuring at domcontentloaded reports the
 * splash as the screen. This polls the rendered text until two consecutive
 * reads agree, which is cheap and does not depend on knowing which screen has
 * an animation on it.
 */
export async function warmGoto(page: Page, route: string): Promise<number | null> {
  const res = await page.goto(route.startsWith("http") ? route : BASE + route, {
    waitUntil: "domcontentloaded",
    timeout: 25_000,
  });
  /* Element count, not text length. A live ticker rewrites its own text every
     second, so a text-length signal never settles and every navigation pays the
     full timeout. Structure settles; a quote does not. */
  let last = -1;
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(250);
    let now = -1;
    try {
      now = await page.evaluate(() => document.querySelectorAll("*").length);
    } catch {
      continue;
    }
    if (now === last && i >= 1) break;
    last = now;
  }
  return res?.status() ?? null;
}

/** Sign in through the real form. Scoped to the visible form; /auth mounts two. */
export async function signIn(page: Page): Promise<void> {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;
  if (!email || !password) throw new Error("E2E_USER_EMAIL / E2E_USER_PASSWORD missing from .env.local");
  await page.goto(BASE + "/auth", { waitUntil: "domcontentloaded" });
  const form = page.locator("form:visible").first();
  await form.getByPlaceholder("Email address").fill(email);
  await form.getByPlaceholder("Password").fill(password);
  await form.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 25_000 });
}

/** Read the reader's own rows back through PostgREST, service role, READ ONLY. */
export async function pgRead(pathAndQuery: string): Promise<unknown> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("supabase env missing");
  const res = await fetch(`${url}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`pgRead ${res.status}: ${await res.text()}`);
  return res.json();
}

export const E2E_USER_ID = "3d8a6b43-3581-4bb5-8a83-10a5f14f7b28";

/** Marker planted in every row this harness authors, so it is identifiable. */
export const TEST_TAG = "[pressure-harness]";

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

export async function installGuards(
  context: BrowserContext,
  /** Extra origins the guard lets through, e.g. the foreign-referrer stub. */
  allowOrigins: string[] = [],
): Promise<GuardState> {
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
    if (allowOrigins.includes(origin)) return route.continue();
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
 * A genuine cold entry, and it will refuse rather than lie.
 *
 * WHAT WENT WRONG THE FIRST TIME, measured, because the fix is not the obvious
 * one. `newPage()` starts on `about:blank`, `page.goto` PUSHES, and
 * `location.replace` was reached for to avoid that. All true, and the call
 * still reported `history.length = 3`. `location.replace` was working
 * perfectly: it replaces THE ENTRY IT IS STANDING ON, and two entries already
 * existed underneath it because the caller had reused a page that had already
 * navigated. `history.length` is a property of the TAB, not of the call.
 *
 * The measurements, on this build:
 *
 *   fresh page                          length 1, url about:blank
 *   fresh page + goto("about:blank")    length 1   <- does NOT push; Chromium
 *                                                     replaces the initial
 *                                                     empty document
 *   fresh page + replace(target)        length 1, navigation index 0,
 *                                       entries ["/deal-flow"]   <- COLD
 *   used page (one goto) + goto(blank)  length 3   <- DOES push, because the
 *                                                     document is no longer
 *                                                     the initial empty one
 *   used page + replace(target)         length 3, navigation index 1,
 *                                       entries ["/dashboard","/deal-flow"]
 *
 * The last line is the damage, and `history.length` is not even the part that
 * matters. `navigation.currentEntry.index` was 1 with a same-origin page behind
 * it, so `shouldStepBack` would have returned TRUE on a page the harness was
 * calling a cold entry. A back-control test written there measures the
 * step-back branch while believing it measures the cold branch, and reports it
 * green either way.
 *
 * So this refuses to run on a page that has already been somewhere, and gives
 * back the Navigation API's own numbers rather than `history.length`, which is
 * the tab's and not ours.
 */
export interface ColdEntry {
  historyLength: number;
  /** Our slice: 0 means nothing of ours is behind this page. */
  navIndex: number | undefined;
  navEntries: number | undefined;
  /** The URLs in our slice. The direct proof of what is and is not reachable. */
  navUrls: string[] | undefined;
}

export async function coldGoto(page: Page, url: string): Promise<ColdEntry> {
  const target = url.startsWith("http") ? url : BASE + url;

  const before = await page.evaluate(() => ({ len: history.length, href: location.href }));
  if (before.href !== "about:blank" || before.len !== 1) {
    throw new Error(
      `coldGoto needs a page that has never navigated. This one is at ${before.href} with history.length ${before.len}. ` +
        `location.replace can only replace the entry it stands on, so entries underneath survive and the result is not a cold entry. ` +
        `Call newPage() and pass the fresh page.`,
    );
  }

  await Promise.all([
    page.waitForURL((u) => u.toString().startsWith(target), { timeout: 20_000 }),
    page.evaluate((u) => {
      window.location.replace(u as string);
    }, target),
  ]);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(400);
  return readEntry(page);
}

/** The Navigation API's view of OUR slice, which is the property the app reads. */
export async function readEntry(page: Page): Promise<ColdEntry> {
  return page.evaluate(() => {
    const nav = (window as unknown as {
      navigation?: {
        currentEntry?: { index?: number } | null;
        entries?: () => { url?: string }[];
      };
    }).navigation;
    const entries = nav?.entries ? nav.entries() : undefined;
    return {
      historyLength: history.length,
      navIndex: typeof nav?.currentEntry?.index === "number" ? nav.currentEntry.index : undefined,
      navEntries: entries ? entries.length : undefined,
      navUrls: entries ? entries.map((e) => e.url ?? "") : undefined,
    };
  });
}

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
  /* Attribute selectors rather than `getByPlaceholder`: the camelCase
     method name defeats the design linter's own word-boundary allowlist for
     the substring inside "placeholder", and an ERROR on a Playwright API name
     is noise the next reader has to re-derive. */
  await form.locator('input[placeholder="Email address"]').fill(email);
  await form.locator('input[placeholder="Password"]').fill(password);
  await form.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 25_000 });
}

/**
 * Is there a live session on this page, and if not, make one.
 *
 * `supabase.auth.signOut()` revokes the refresh token GLOBALLY, so a saved
 * storage state stops working the moment any context signs out. The walk taps
 * a Sign out button, so that is not hypothetical: every later spec would start
 * from a dead cookie and measure a signed-out app. This checks a route that
 * answers 401 without a session and re-signs where needed.
 *
 * Returns true when it had to sign in, so the caller can say so.
 */
export async function ensureSignedIn(page: Page, saveTo?: string): Promise<boolean> {
  const status = await page.evaluate(async () => {
    try {
      const r = await fetch("/api/radar/claims", { method: "GET" });
      return r.status;
    } catch {
      return 0;
    }
  }).catch(() => 0);
  if (status === 200) return false;
  await signIn(page);
  if (saveTo) await page.context().storageState({ path: saveTo });
  return true;
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

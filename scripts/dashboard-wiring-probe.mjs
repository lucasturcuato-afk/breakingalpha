/**
 * Evidence harness for the mobile Dashboard wiring (PR #675).
 *
 * It exists because the first version of this PR's "desktop unchanged" proof
 * fingerprinted the WRONG ELEMENT. It used
 * `document.querySelector(".hidden.md\\:block")`, which at 1440 matches four
 * things and gives back `app-shell.tsx:128`, the nav sidebar, first. Both
 * captures came out at 128 nodes because both were the sidebar. The desktop
 * dashboard grid is 282 NODES under `reducedMotion: "reduce"`, which is how
 * `dom` mode below captures it, and it was never measured. A one-off snippet
 * typed twice is how that happens, so the snippet lives in the repo now.
 *
 * 282 and not 277: unpinned, the rotating hero can be sitting on a different
 * lead story with a different subtree, and the grid measures 277. Both numbers
 * are the same page in two renderings. Pin it, and compare pinned to pinned.
 *
 * Sign-in is the EMAIL AND PASSWORD FORM at /auth, from `.env.local`. Nothing
 * touches Google. Locators are scoped to `form:visible` because two forms are
 * in the DOM there and an unscoped locator is strict-mode ambiguous.
 *
 * Nothing here writes to the database. `stall` and `slow` only intercept
 * responses on the way in.
 *
 *   node scripts/dashboard-wiring-probe.mjs dom   [out.txt]
 *   node scripts/dashboard-wiring-probe.mjs stall [out.png]
 *   node scripts/dashboard-wiring-probe.mjs slow
 *   node scripts/dashboard-wiring-probe.mjs fail  [out.png]
 *   node scripts/dashboard-wiring-probe.mjs fonts
 *
 * BASE defaults to http://localhost:3211 and should point at a PRODUCTION
 * build (`npm run build && npx next start -p 3211`). Computed font families
 * differ under dev.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3211";
const MODE = process.argv[2] ?? "stall";
const OUT = process.argv[3];

const env = Object.fromEntries(
  readFileSync(new URL("./.env.local", `file://${process.cwd()}/`), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

/** Every read the mobile screen paints from. `stall` never answers any of them. */
const STALLED = [
  /rest\/v1\/articles/,
  /rest\/v1\/briefings/,
  /rest\/v1\/pipeline_runs/,
  /rest\/v1\/morning_brief/,
  /rest\/v1\/source_credibility/,
  /\/api\/market-indices/,
  /\/api\/radar\/claims/,
];

async function signIn(page) {
  await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" });
  const form = page.locator("form:visible").first();
  await form.locator('input[type="email"]').fill(env.E2E_USER_EMAIL);
  await form.locator('input[type="password"]').fill(env.E2E_USER_PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 45000 }),
    form.locator('button[type="submit"]').first().click(),
  ]);
}

const browser = await chromium.launch();

if (MODE === "dom") {
  /* `reducedMotion: "reduce"` is what makes this instrument deterministic.
     `rotating-lead-hero.tsx` advances the desktop hero every 7s and calls
     `useReducedMotion()` to skip the interval entirely, so under reduce the
     hero is pinned at index 0 and the two captures fingerprint the same
     story. Without it the signature depends on which second it was taken and
     the diff is the hero rotating, not the page changing. */
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  await signIn(page);
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  await page.waitForTimeout(12000);

  const result = await page.evaluate(() => {
    const all = [...document.querySelectorAll(".hidden.md\\:block")];
    /* SCOPED TO THE DASHBOARD PAGE'S OWN WRAPPER. `.dash-contentwrap` is the
       dashboard grid and nothing else on the page carries it, so its enclosing
       `hidden md:block` is unambiguous. */
    const root = document.querySelector(".dash-contentwrap")?.closest(".hidden.md\\:block") ?? null;
    const lines = [];
    const walk = (el, depth) => {
      const r = el.getBoundingClientRect();
      lines.push(
        `${"  ".repeat(depth)}${el.tagName.toLowerCase()}|${el.getAttribute("class") ?? ""}` +
          `|${Math.round(r.width)}x${Math.round(r.height)}`,
      );
      for (const child of el.children) walk(child, depth + 1);
    };
    if (root) walk(root, 0);
    const mobile = document.querySelector('[data-parity="dash"]');
    const mr = mobile?.getBoundingClientRect();
    return {
      hiddenMdBlockMatches: all.length,
      firstMatchIsNavSidebar: !!all[0]?.querySelector("aside"),
      dashboardWrapperIndex: all.indexOf(root),
      mobileScreenAt1440: mobile
        ? `${Math.round(mr.width)}x${Math.round(mr.height)}`
        : "absent",
      nodes: lines.length,
      signature: lines.join("\n"),
    };
  });

  const { signature, ...meta } = result;
  console.log(JSON.stringify(meta, null, 2));
  if (OUT) writeFileSync(OUT, `${signature}\n`);
}

if (MODE === "stall" || MODE === "slow" || MODE === "fail") {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  await signIn(page);
  if (MODE === "stall") {
    await page.route("**/*", (route) => {
      if (STALLED.some((re) => re.test(route.request().url()))) return; // never answered
      return route.continue();
    });
  } else if (MODE === "fail") {
    /* ONLY the Top Stories select. The three count queries go to the same
       table as HEAD requests, so filtering on method leaves them answering
       normally and isolates the one read whose failure used to take the whole
       screen down. */
    await page.route(/rest\/v1\/articles/, (route) => {
      if (route.request().method() !== "GET") return route.continue();
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "probe: forced failure" }),
      });
    });
  } else {
    await page.route("**/api/market-indices**", async (route) => {
      await new Promise((r) => setTimeout(r, 7000));
      return route.continue();
    });
  }
  await page.goto(`${BASE}/dashboard`, { waitUntil: "commit" });
  let last = 0;
  for (const t of [4000, 11000, 16000, 26000]) {
    await page.waitForTimeout(t - last);
    last = t;
    const s = await page.evaluate(() => {
      const el = document.querySelector('[data-parity="dash"]');
      if (!el) return { at: "no screen root" };
      const text = (el.innerText || "").replace(/\s+/g, " ").trim();
      return {
        skeleton: !!el.querySelector('[aria-busy="true"]'),
        ariaBusy: el.querySelector("[aria-busy]")?.getAttribute("aria-busy") ?? null,
        signalsCell: (text.match(/SIGNALS TODAY[^]{0,24}/) ?? ["(absent)"])[0],
        overnightClaim: /has not published/.test(text),
        /* Which sections survived. The point of the `fail` mode: one broken
           read must not take the four that answered with it. */
        sections: ["waiting for you", "your record", "the desk's record", "top stories"].filter(
          (label) => text.toLowerCase().includes(label),
        ),
        wholeScreenError: /We could not load your briefing/.test(text),
        storiesSectionError: /We could not load your top stories/.test(text),
        brief: /The morning brief/.test(text),
        marketCells: el.querySelectorAll("[class*=figcell]").length,
        revealReason:
          document.querySelector("[data-reveal-reason]")?.getAttribute("data-reveal-reason") ?? "",
        chars: text.length,
        head: text.slice(0, 200),
      };
    });
    console.log(`--- t=${t}ms ${JSON.stringify(s, null, 2)}`);
  }
  if (OUT) await page.screenshot({ path: OUT });
}

if (MODE === "fonts") {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  await signIn(page);
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  await page.waitForTimeout(14000);
  const census = await page.evaluate(() => {
    const tally = (root, scope) => {
      if (!root) return { scope, nodes: 0, families: {} };
      const els = [root, ...root.querySelectorAll("*")];
      const families = {};
      for (const el of els) {
        const f = getComputedStyle(el).fontFamily;
        families[f] = (families[f] ?? 0) + 1;
      }
      return { scope, nodes: els.length, families };
    };
    return {
      /* SCREEN SUBTREE, which is the scope every count below is stated in. */
      screen: tally(document.querySelector('[data-parity="dash"]'), '[data-parity="dash"]'),
      /* The whole document, for contrast only. Never report this one as if it
         were the screen's. */
      document: tally(document.body, "<body>"),
    };
  });
  console.log(JSON.stringify(census, null, 2));
}

await browser.close();

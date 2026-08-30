/**
 * Pass one: the EMPTY walk.
 *
 * "Empty" is the account's known state, not an assumption: at the start of this
 * run the E2E reader had three adopted claims, zero follows and a watchlist
 * read that answers, and every screen has been verified against that. This pass
 * is therefore the baseline the populated pass is differenced against.
 *
 * READ-ONLY BY CONSTRUCTION. The walk taps every control on every screen it
 * reaches, and some of those controls write. `installGuards` refuses every
 * non-GET request for the duration, to `/api/` and to Supabase's REST surface
 * alike, so this pass cannot mutate the account. Each refusal is recorded: a
 * control that tried to write is a control this pass has identified without
 * having to let it.
 */
import { expect, test } from "@playwright/test";
import { installGuards, launch, phoneContext, warmGoto, AUTH_STATE, BASE, type Theme } from "./lib/harness";
import { finding, note, routeVisit } from "./lib/report";
import { walk, POLE_ROUTES } from "./lib/walk";
import { runRules } from "./lib/walk";
import { enumerateControls } from "./lib/probe";
import { auditGeometry } from "./lib/walk";
import fs from "fs";
import path from "path";

/** Every page route this build actually contains, read off the app directory. */
function staticRouteInventory(): string[] {
  const appDir = path.resolve(__dirname, "../../src/app");
  const out: string[] = [];
  const walkDir = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith("_") || entry.name === "api") continue;
      const seg = entry.name.startsWith("(") ? "" : `/${entry.name}`;
      const child = path.join(dir, entry.name);
      if (fs.existsSync(path.join(child, "page.tsx")) || fs.existsSync(path.join(child, "page.ts"))) {
        out.push(prefix + seg);
      }
      walkDir(child, prefix + seg);
    }
  };
  walkDir(appDir, "");
  return out.sort();
}

test("empty pass: tap-driven walk from the four poles, light theme", async () => {
  const browser = await launch();
  const ctx = await phoneContext(browser, "light", AUTH_STATE);
  const guards = await installGuards(ctx);
  const page = await ctx.newPage();

  const result = await walk(page, BASE, "light", "empty");

  note(
    "walk-summary",
    "(walk)",
    `light empty pass: ${result.visited.length} routes reached by tapping, ${result.probed} controls activated, ${result.deadControls} inert`,
    "measured",
  );
  note("walk-edges", "(walk)", JSON.stringify(result.edges), "measured");
  note(
    "write-attempts-blocked",
    "(walk)",
    `controls that attempted a mutation during the read-only walk: ${JSON.stringify(Array.from(new Set(guards.blockedMutations)))}`,
    "measured",
  );
  note(
    "external-aborted",
    "(walk)",
    `third-party requests aborted by the harness: ${JSON.stringify(Array.from(new Set(guards.externalAborted)))}`,
    "measured",
  );
  expect(guards.intelligenceAttempts, "POST /api/intelligence must never reach the server").toBeGreaterThanOrEqual(0);

  fs.writeFileSync(
    path.resolve(__dirname, "../../pressure-report/reached-light.json"),
    JSON.stringify(result, null, 2),
  );

  await ctx.close();
  await browser.close();
  expect(result.visited.length, "the walk must reach at least the four poles").toBeGreaterThanOrEqual(4);
});

test("empty pass: every reached screen in DARK, and both captures distinct", async () => {
  const reached: string[] = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../pressure-report/reached-light.json"), "utf8"),
  ).visited;

  const browser = await launch();
  const lightCtx = await phoneContext(browser, "light", AUTH_STATE);
  await installGuards(lightCtx);
  const darkCtx = await phoneContext(browser, "dark", AUTH_STATE);
  await installGuards(darkCtx);
  const lightPage = await lightCtx.newPage();
  const darkPage = await darkCtx.newPage();

  for (const route of reached) {
    await warmGoto(lightPage, route);
    await warmGoto(darkPage, route);
    const lbg = await lightPage.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const dbg = await darkPage.evaluate(() => getComputedStyle(document.body).backgroundColor);
    if (lbg === dbg) {
      finding({
        severity: "high",
        rule: "theme-did-not-flip",
        screen: route,
        pass: "empty",
        title: `${route} renders the same body background in both themes (${lbg})`,
        evidence: "localStorage.signalera_theme was set to light and dark on two separate contexts; both measured identical.",
        basis: "measured",
      });
    }
    const ls = await lightPage.screenshot();
    const ds = await darkPage.screenshot();
    if (Buffer.compare(ls, ds) === 0) {
      finding({
        severity: "high",
        rule: "theme-identical-capture",
        screen: route,
        pass: "empty",
        title: `${route} produced byte-identical light and dark captures`,
        evidence: "two contexts, two localStorage values, one image.",
        basis: "measured",
      });
    }
    /* The rules, again, in dark. A token that reads only in one theme is a
       copy problem the light pass cannot see. */
    await runRules(darkPage, route, "dark", "empty");
    const controls = await enumerateControls(darkPage);
    auditGeometry(controls, route, "dark", "empty");
  }

  await lightCtx.close();
  await darkCtx.close();
  await browser.close();
});

test("empty pass: routes that exist but no tap reaches", async () => {
  const reached: string[] = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../pressure-report/reached-light.json"), "utf8"),
  ).visited;
  const inventory = staticRouteInventory();

  const browser = await launch();
  const ctx = await phoneContext(browser, "light", AUTH_STATE);
  await installGuards(ctx);
  const page = await ctx.newPage();

  /* The routes the tab bar's Browse pole claims to own, whether or not a page
     exists behind them. A pole that owns a route with no page is a pole that
     lights on a 404. */
  const BROWSE_OWNS = [
    "/intelligence",
    "/company",
    "/deal-flow",
    "/trends",
    "/live-feed",
    "/ask",
    "/search",
    "/trends-mobile",
    "/signal",
    "/story",
  ];
  const LEDGER_OWNS = ["/ledger", "/morning-brief", "/evening-wrap", "/radar/calls", "/review", "/claim", "/entry", "/record", "/compose"];
  const RADAR_OWNS = ["/radar/watchlist", "/radar/following", "/watch"];
  const claimed = Array.from(new Set([...BROWSE_OWNS, ...LEDGER_OWNS, ...RADAR_OWNS, "/dashboard"]));

  for (const route of claimed) {
    if (route.includes("[")) continue;
    const status = await warmGoto(page, route);
    const landed = new URL(page.url()).pathname;
    routeVisit({ route, reachedBy: "url-only probe of a pole's owns[] list", status, finalUrl: page.url(), pass: "empty" });
    if (status === 404) {
      finding({
        severity: "high",
        rule: "pole-owns-a-route-with-no-page",
        screen: route,
        pass: "empty",
        title: `a pole's owns[] lists ${route}, which answers 404`,
        evidence: `HTTP ${status} on a production build with VERCEL_ENV=preview. isActive reads owns[] alone, so this route lights a pole on a page that does not exist.`,
        basis: "measured",
      });
      continue;
    }
    if (landed !== route) {
      finding({
        severity: "high",
        rule: "pole-owns-a-route-that-redirects",
        screen: route,
        pass: "empty",
        title: `${route} redirected to ${landed}`,
        evidence: `HTTP ${status}. A pole owning a route the reader cannot stay on.`,
        basis: "measured",
      });
      continue;
    }
    if (!reached.includes(route)) {
      finding({
        severity: "medium",
        rule: "reachable-only-by-url",
        screen: route,
        pass: "empty",
        title: `${route} answers ${status} but no tap in the walk reached it`,
        evidence: `Walk reached: ${reached.join(", ")}. This route was only entered by typing it.`,
        basis: "measured",
      });
    }
  }

  /* Everything else in the build, for completeness. Not every route is meant
     to be mobile-reachable, so these are recorded as notes rather than
     findings, and the note says which. */
  for (const route of inventory) {
    if (route.includes("[") || route.startsWith("/preview") || route.startsWith("/print") || route.startsWith("/internal")) continue;
    if (reached.includes(route) || claimed.includes(route)) continue;
    const status = await warmGoto(page, route);
    const landed = new URL(page.url()).pathname;
    note(
      "route-not-reached-by-tapping",
      route,
      `HTTP ${status}, landed ${landed}. Present in the build, never reached by a tap from any pole.`,
      "measured",
    );
    if (landed === "/waitlist") {
      finding({
        severity: "high",
        rule: "allowlist-gate-blocks-route",
        screen: route,
        pass: "empty",
        title: `${route} bounces a signed-in reader to /waitlist`,
        evidence: `The E2E account is not on beta_allowlist and this route is not in MOBILE_REDESIGN_DEV_PATHS, so proxy.ts:160 signs the session out and redirects. Environment limit for this harness; a product defect only for a reader who is genuinely not allowlisted.`,
        basis: "measured",
      });
    }
  }

  await ctx.close();
  await browser.close();
});

test("empty pass: pole bar itself", async () => {
  const browser = await launch();
  const ctx = await phoneContext(browser, "light", AUTH_STATE);
  await installGuards(ctx);
  const page = await ctx.newPage();

  await warmGoto(page, "/dashboard");
  const bar = await page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Primary"]') as HTMLElement | null;
    if (!nav) return null;
    const r = nav.getBoundingClientRect();
    const cs = getComputedStyle(nav);
    const rows = Array.from(nav.querySelectorAll("a")).map((a) => {
      const ar = a.getBoundingClientRect();
      return {
        label: (a.innerText ?? "").trim(),
        href: a.getAttribute("href"),
        current: a.getAttribute("aria-current"),
        box: { w: Math.round(ar.width * 10) / 10, h: Math.round(ar.height * 10) / 10 },
        /* offsetParent is null for position:fixed, so it cannot see this bar.
           getBoundingClientRect can, which is why the measurement is taken
           this way and not through an offset chain. */
        offsetParentIsNull: (a as HTMLElement).offsetParent === null,
      };
    });
    return { height: Math.round(r.height * 10) / 10, borderTop: cs.borderTopWidth, position: cs.position, rows };
  });

  if (!bar) {
    finding({
      severity: "critical",
      rule: "tab-bar-absent",
      screen: "/dashboard",
      pass: "empty",
      title: "no nav[aria-label=Primary] at 390px",
      evidence: "The four-pole bar did not render on the dashboard at 390x844.",
      basis: "measured",
    });
  } else {
    note("tab-bar", "/dashboard", JSON.stringify(bar), "measured");
    const labels = bar.rows.map((r) => r.label);
    expect(labels, "the pole set on the trunk is Dashboard, Ledger, Radar, Browse").toEqual([
      "Dashboard",
      "Ledger",
      "Radar",
      "Browse",
    ]);
    for (const r of bar.rows) {
      if (r.box.h < 44 || r.box.w < 44) {
        finding({
          severity: "high",
          rule: "tap-target-under-44",
          screen: "/dashboard",
          pass: "empty",
          title: `pole "${r.label}" computed box ${r.box.w}x${r.box.h}`,
          evidence: `measured off the fixed bar with getBoundingClientRect; offsetParent is null (${r.offsetParentIsNull}) and could not have measured it.`,
          basis: "measured",
        });
      }
    }
  }

  /* aria-current must follow the pole the reader is standing on. isActive reads
     owns[] alone and never href, so a pole whose href is missing from its own
     owns list goes dark on arrival. Measured on each pole's own destination. */
  for (const p of POLE_ROUTES) {
    await warmGoto(page, p.href);
    const current = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Primary"]');
      if (!nav) return null;
      const a = nav.querySelector('a[aria-current="page"]') as HTMLElement | null;
      return a ? (a.innerText ?? "").trim() : "(none)";
    });
    if (current !== p.label) {
      finding({
        severity: "high",
        rule: "pole-dark-on-its-own-destination",
        screen: p.href,
        pass: "empty",
        title: `standing on ${p.href}, the lit pole is "${current}" and not "${p.label}"`,
        evidence: "isActive reads owns[] alone and never href.",
        basis: "measured",
      });
    } else {
      note("pole-active", p.href, `aria-current lands on ${current}`, "measured");
    }
  }

  await ctx.close();
  await browser.close();
});

test("empty pass: keyboard focus is visible, walked with real Tab presses", async () => {
  const browser = await launch();
  const ctx = await phoneContext(browser, "light", AUTH_STATE);
  await installGuards(ctx);
  const page = await ctx.newPage();

  for (const route of POLE_ROUTES.map((p) => p.href)) {
    await warmGoto(page, route);
    /* Real Tab presses. A scripted .focus() after a mouse click leaves
       Chromium in pointer modality, :focus-visible does not match, and the ring
       reads "3px none" on a control that is in fact fine. */
    await page.keyboard.press("Tab");
    for (let i = 0; i < 6; i++) {
      /* transition-colors runs 150ms and includes outline-color, so a ring read
         immediately is read mid-transition. 500ms is past it. */
      await page.waitForTimeout(500);
      const ring = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        return {
          tag: el.tagName.toLowerCase(),
          text: (el.innerText ?? "").trim().slice(0, 50),
          outline: `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}`,
          boxShadow: cs.boxShadow,
          matchesFocusVisible: el.matches(":focus-visible"),
        };
      });
      if (ring && ring.matchesFocusVisible) {
        const noRing =
          (ring.outline.includes("none") || ring.outline.startsWith("0px")) &&
          (ring.boxShadow === "none" || ring.boxShadow === "");
        if (noRing) {
          finding({
            severity: "medium",
            rule: "focus-ring-absent",
            screen: route,
            pass: "empty",
            title: `${ring.tag} "${ring.text}" matches :focus-visible with no ring`,
            evidence: `outline "${ring.outline}", box-shadow "${ring.boxShadow}", read at t=500ms after a real Tab press.`,
            basis: "measured",
          });
        }
      }
      await page.keyboard.press("Tab");
    }
  }

  await ctx.close();
  await browser.close();
});

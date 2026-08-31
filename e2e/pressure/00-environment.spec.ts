/**
 * Prove the target before measuring anything on it.
 *
 * Every trap this suite exists to avoid is an environment trap: a dev server
 * serving fixtures, an emulation that did not land, a theme that captured light
 * twice, a history entry Playwright added. Each one is asserted here, once, and
 * a failure here invalidates everything downstream rather than quietly
 * colouring it.
 */
import { expect, test } from "@playwright/test";
import fs from "fs";
import path from "path";
import { assertEmulation, coldGoto, installGuards, launch, phoneContext, signIn, warmGoto, AUTH_STATE, BASE } from "./lib/harness";
import { finding, note, resetReport } from "./lib/report";

test("environment: production build, preview gate, phone emulation, real session", async () => {
  resetReport();

  /* 1. The server answers and it is a production build. `next start` sets
        NODE_ENV=production, and the observable consequence is that React
        ships no development build marker and the fixture gate is shut. */
  const browser = await launch();
  const ctx = await phoneContext(browser, "light");
  await installGuards(ctx);
  const page = await ctx.newPage();

  const res = await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  expect(res?.status(), "server on 3370 must answer").toBeLessThan(400);

  const isDevBuild = await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    return Boolean(w.__NEXT_DATA__ && (w.__NEXT_DATA__ as { buildId?: string }).buildId === "development");
  });
  expect(isDevBuild, "must not be a dev server: a dev build serves the mobile fixtures").toBe(false);
  note("environment", "(server)", `production build confirmed, __NEXT_DATA__.buildId is not "development"`, "measured");

  /* 2. VERCEL_ENV=preview opened the mobile routes. Measured by asking for
        /dashboard SIGNED OUT: without the preview clause the proxy 307s to
        /auth, with it the route is a public path and answers 200. */
  const anonCtx = await phoneContext(browser, "light");
  await installGuards(anonCtx);
  const anon = await anonCtx.newPage();
  const dash = await anon.goto(BASE + "/dashboard", { waitUntil: "domcontentloaded" });
  expect(dash?.status(), "VERCEL_ENV=preview must open /dashboard to an unauthenticated client").toBe(200);
  expect(new URL(anon.url()).pathname).toBe("/dashboard");
  note("environment", "/dashboard", "VERCEL_ENV=preview confirmed: signed-out /dashboard answers 200 and stays put", "measured");
  await anonCtx.close();

  /* 3. Emulation landed. hasTouch on the CONTEXT is what flips any-hover;
        Emulation.setEmulatedMedia alone does not. */
  const emu = await assertEmulation(page);
  expect(emu.width, "viewport must be 390").toBe(390);
  expect(emu.touch, "hasTouch must be on the context").toBe(true);
  expect(emu.anyHoverNone, "(any-hover: none) must match, or every hover audit is wrong").toBe(true);
  note("environment", "(context)", `390px, hasTouch true, (any-hover:none) matches`, "measured");

  /* 4. A genuine cold entry, ON A PAGE THAT HAS NEVER NAVIGATED.
        The first version of this reused the page above, which had already
        loaded "/". `location.replace` replaces only the entry it stands on, so
        two entries survived underneath and the "cold" page reported
        `navigation.currentEntry.index === 1`: a same-origin page behind it, and
        `shouldStepBack` true on the page the harness was calling cold. See
        coldGoto's own note for the measurements. */
  const coldPage = await ctx.newPage();
  const cold = await coldGoto(coldPage, "/ledger");
  note(
    "environment",
    "/ledger",
    `cold entry on a fresh page: history.length ${cold.historyLength}, navigation index ${cold.navIndex}, entries ${cold.navEntries}`,
    "measured",
  );
  expect(cold.historyLength, "a cold entry leaves one tab history entry").toBe(1);
  expect(cold.navIndex, "nothing of ours may be behind a cold entry").toBe(0);
  expect(cold.navEntries, "our slice holds exactly the page we landed on").toBe(1);
  await coldPage.close();

  /* 5. Two DISTINCT theme captures. localStorage.signalera_theme, via
        addInitScript, read before paint. emulateMedia does nothing here, and a
        run that trusts it captures light twice and calls it a theme pass. */
  const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const darkCtx = await phoneContext(browser, "dark");
  await installGuards(darkCtx);
  const darkPage = await darkCtx.newPage();
  await warmGoto(darkPage, "/ledger");
  const darkBg = await darkPage.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const lightShot = await page.screenshot();
  const darkShot = await darkPage.screenshot();

  note("environment", "/ledger", `light body background ${lightBg}; dark body background ${darkBg}`, "measured");
  expect(darkBg, `THEME DID NOT FLIP: both captures read ${lightBg}`).not.toBe(lightBg);
  expect(
    Buffer.compare(lightShot, darkShot),
    "light and dark screenshots are byte-identical: the theme did not flip",
  ).not.toBe(0);

  /* The prompt names rgb(250,247,242) / rgb(15,15,15). tokens.css sets
     --c-bg to #fffdf9 / #14100a. Record what was actually measured rather than
     asserting someone's remembered value. */
  if (lightBg !== "rgb(250, 247, 242)" || darkBg !== "rgb(15, 15, 15)") {
    finding({
      severity: "info",
      rule: "theme-token-value",
      screen: "/ledger",
      pass: "static",
      title: "body background is not the pair the brief quoted",
      evidence: `measured light ${lightBg} dark ${darkBg}; brief said rgb(250,247,242)/rgb(15,15,15); tokens.css:59/499 set --c-bg #fffdf9 / #14100a. The captures ARE distinct, so the theme flipped.`,
      basis: "measured",
    });
  }
  await darkCtx.close();

  /* 6. A real session, through the real form. */
  await signIn(page);
  const who = await page.evaluate(async () => {
    const r = await fetch("/api/user-profile");
    return { status: r.status };
  });
  note("environment", "(session)", `signed in; /api/user-profile answered ${who.status}`, "measured");

  fs.mkdirSync(path.dirname(AUTH_STATE), { recursive: true });
  await ctx.storageState({ path: AUTH_STATE });

  await ctx.close();
  await browser.close();
});

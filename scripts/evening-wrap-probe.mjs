/**
 * Evening Wrap verification probe.
 *
 * A committed script rather than a snippet typed twice, because the two things
 * this measures are exactly the two an ad hoc selector gets wrong: which
 * subtree the desk signature covers, and which requests belong to the mobile
 * screen rather than to the page around it.
 *
 * It never writes anything. It signs in through the VISIBLE email and password
 * form at /auth, reading the E2E account out of .env.local by variable name,
 * and reads the rendered page.
 *
 *   node scripts/evening-wrap-probe.mjs screen  [out.json]   390x844, signed in
 *   node scripts/evening-wrap-probe.mjs desk    [out.txt]    1440 box tree + requests
 *
 * `e2e/auth-helper.ts` on main has a strict-mode bug because two forms are in
 * the DOM at /auth, so the locator here is scoped to `form:visible`.
 *
 * BASE defaults to a local production build on 3203. Point it anywhere local;
 * never at a preview URL, which answers 302 to a Vercel login.
 */

import { chromium } from "@playwright/test";
import fs from "fs";

const BASE = process.env.PROBE_BASE || "http://localhost:3203";
const MODE = process.argv[2] || "screen";
const OUT = process.argv[3] || null;

/** The three families `src/app/layout.tsx` loads through next/font. */
const LOADED = ["Fraunces", "Space Grotesk", "IBM Plex Mono"];

function env() {
  return Object.fromEntries(
    fs.readFileSync(".env.local", "utf8").split("\n")
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
  );
}

async function signIn(page, e) {
  await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const form = page.locator("form:visible").first();
  await form.locator('input[type="email"]').fill(e.E2E_USER_EMAIL);
  await form.locator('input[type="password"]').fill(e.E2E_USER_PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 45000 }).catch(() => {}),
    form.locator('button[type="submit"]:visible').first().click(),
  ]);
  await page.waitForTimeout(2500);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: MODE === "desk" ? { width: 1440, height: 900 } : { width: 390, height: 844 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
});
const auth = await ctx.newPage();
await signIn(auth, env());

const page = await ctx.newPage();
const requests = [];
page.on("request", (r) => requests.push(r.url()));
await page.setViewportSize(MODE === "desk" ? { width: 1440, height: 900 } : { width: 390, height: 844 });
await page.goto(`${BASE}/evening-wrap`, { waitUntil: "load" });
await page.waitForTimeout(MODE === "desk" ? 20000 : 9000);

if (MODE === "desk") {
  await page.addStyleTag({ content: "*{animation:none !important;transition:none !important}" });
  /* The desk signature is scoped to <main>. The mobile subtree is mounted
     OUTSIDE AppShell, so it is not inside <main> and cannot pad this count;
     the probe asserts that rather than assuming it. */
  const out = await page.evaluate(() => {
    const main = document.querySelector("main");
    const root = document.querySelector('[data-parity="evening"]');
    const els = [main];
    const w = document.createTreeWalker(main, NodeFilter.SHOW_ELEMENT);
    let n; while ((n = w.nextNode())) els.push(n);
    const rows = els.map((el) => {
      let d = 0, q = el; while (q && q !== main) { d++; q = q.parentElement; }
      const r = el.getBoundingClientRect();
      return [el.tagName, d, Math.round(r.x), Math.round(r.y),
        Math.round(r.width), Math.round(r.height), getComputedStyle(el).display].join("|");
    });
    const wrap = document.querySelector(".hidden.md\\:contents");
    return {
      rows,
      mobileSubtreeUnderMain: !!(main && root && main.contains(root)),
      mobileRootBox: root ? `${Math.round(root.getBoundingClientRect().width)} x ${Math.round(root.getBoundingClientRect().height)}` : "absent",
      deskWrapperDisplay: wrap ? getComputedStyle(wrap).display : "absent",
    };
  });
  const norm = (u) => u.replace(/https:\/\/[a-z0-9]+\.supabase\.co/, "SUPA").replace(BASE, "");
  /* The three the mobile screen owns, by their exact shapes. */
  const mine = requests.filter((u) =>
    /morning_brief_calls\?select=id%2Cclaim_text%2Ctarget_symbol%2Cresolve_on%2Cconfidence/.test(u) ||
    /watchlist-quotes\?symbols=SPY(%2C|,)NVDA/.test(u) ||
    /watchlist-quotes\?symbols=[A-Z.]{1,6}$/.test(u));
  console.log(JSON.stringify({
    mode: "desk", totalRequests: requests.length, mainBoxRows: out.rows.length,
    mobileOwnedRequestsFired: mine.length, mobileOwnedRequests: mine.map(norm),
    mobileSubtreeUnderMain: out.mobileSubtreeUnderMain,
    mobileRootBox: out.mobileRootBox, deskWrapperDisplay: out.deskWrapperDisplay,
  }, null, 2));
  if (OUT) fs.writeFileSync(OUT, out.rows.join("\n") + "\n");
} else {
  const out = await page.evaluate((loaded) => {
    const root = document.querySelector('[data-parity="evening"]');
    if (!root) return { present: false };
    const els = [root];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let n; while ((n = w.nextNode())) els.push(n);
    const fams = {}; let textNodes = 0; const unloaded = [];
    for (const el of els) {
      if (!Array.from(el.childNodes).some((c) => c.nodeType === 3 && c.textContent.trim())) continue;
      textNodes++;
      const ff = getComputedStyle(el).fontFamily;
      fams[ff] = (fams[ff] || 0) + 1;
      const first = ff.split(",")[0].replace(/["']/g, "").trim();
      if (loaded.some((f) => first === f || first === `${f} Fallback`)) continue;
      /* Attribute it: the ledger components this screen imports carry their own
         literals and are not this screen's to edit. */
      let chain = "", q = el, d = 0;
      while (q && q !== root && d < 8) {
        chain += `${q.tagName}${typeof q.className === "string" && q.className ? `.${q.className.split(" ")[0]}` : ""} < `;
        q = q.parentElement; d++;
      }
      unloaded.push({ family: ff, chain });
    }
    /* Does `font:` shorthand with a var() family actually resolve? */
    const probe = document.createElement("span");
    probe.style.font = "400 12.5px/1.5 var(--font-space-grotesk), sans-serif";
    probe.textContent = "x"; root.appendChild(probe);
    const probeFF = getComputedStyle(probe).fontFamily; probe.remove();
    const text = root.innerText;
    const r = root.getBoundingClientRect();
    return {
      present: true, box: `${Math.round(r.width)} x ${Math.round(r.height)}`,
      textNodes, unloadedCount: unloaded.length,
      unloadedFromLedger: unloaded.filter((u) => /ledger|module__/.test(u.chain)).length,
      unloadedElsewhere: unloaded.filter((u) => !/ledger|module__/.test(u.chain)).length,
      families: fams, probeFF,
      claimsReachedReviewDate: /reached its review date/.test(text),
      flatMoveWithGlyph: /[▲▼]0\.00%/.test(text),
      emDashes: (text.match(/—/g) || []).length,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    };
  }, LOADED);
  console.log(JSON.stringify(out, null, 2));
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
}

await browser.close();

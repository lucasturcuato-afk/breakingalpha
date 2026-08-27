/**
 * Font-family audit + per-element type-metric capture. READ ONLY.
 * Usage: node font-metrics.mjs <outdir>
 *
 * Probe method matches font-audit.mjs: every element except
 * script/style/link/meta/head/title/noscript, getComputedStyle(el).fontFamily,
 * FIRST family, quotes stripped; loaded means exactly Fraunces, Space Grotesk
 * or IBM Plex Mono. Also records computed fontSize/fontWeight/lineHeight keyed
 * by a stable DOM index path so a before/after diff can assert nothing but the
 * family moved. Theme is a `dark` class on <html> driven by the
 * `signalera_theme` localStorage key, not prefers-color-scheme.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const BASE = "http://localhost:3254";
const OUT = process.argv[2];
const ROUTES = [
  "/trends-mobile", "/deal-flow", "/live-feed", "/desk-record", "/compose", "/ask",
  "/search", "/record", "/watch", "/entry/1", "/ledger", "/dashboard", "/evening-wrap",
  "/morning-brief", "/review", "/saved", "/intelligence", "/claim/1", "/company/Apple",
];
const SHOTS = ["/trends-mobile", "/deal-flow"];
mkdirSync(OUT, { recursive: true });

const PROBE = () => {
  const LOADED = ["Fraunces", "Space Grotesk", "IBM Plex Mono"];
  const first = (ff) => (ff || "").split(",")[0].trim().replace(/^["']|["']$/g, "");
  const skip = new Set(["SCRIPT", "STYLE", "LINK", "META", "HEAD", "TITLE", "NOSCRIPT"]);
  const out = { total: 0, dead: 0, textTotal: 0, textDead: 0, families: {}, metrics: {} };
  const walk = (el, path) => {
    if (skip.has(el.tagName)) return;
    const cs = getComputedStyle(el);
    const f = first(cs.fontFamily);
    if (f) {
      out.total++;
      const bad = !LOADED.includes(f);
      if (bad) { out.dead++; out.families[f] = (out.families[f] || 0) + 1; }
      const ownsText = [...el.childNodes].some(
        (n) => n.nodeType === 3 && n.textContent.trim().length > 0);
      if (ownsText) { out.textTotal++; if (bad) out.textDead++; }
      out.metrics[path + "|" + el.tagName] =
        cs.fontSize + "/" + cs.fontWeight + "/" + cs.lineHeight;
    }
    let i = 0;
    for (const c of el.children) walk(c, path + "." + i++);
  };
  walk(document.documentElement, "0");
  return out;
};

const browser = await chromium.launch();
const results = {};

const signIn = async (page) => {
  await page.goto(`${BASE}/auth`);
  const form = page.locator("form:visible").first();
  await form.getByPlaceholder("Email address").fill(process.env.E2E_USER_EMAIL);
  await form.getByPlaceholder("Password").fill(process.env.E2E_USER_PASSWORD);
  await form.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL("**/dashboard", { timeout: 60000 });
};

// Pass 1: metrics, light theme, all routes.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => localStorage.setItem("signalera_theme", "light"));
  const page = await ctx.newPage();
  await signIn(page);
  for (const r of ROUTES) {
    await page.goto(`${BASE}${r}`, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(1800);
    await page.evaluate(() => document.fonts.ready);
    const res = await page.evaluate(PROBE);
    results[r] = res;
    process.stdout.write(`${r.padEnd(16)} all ${String(res.dead).padStart(5)}/${String(res.total).padEnd(6)}` +
      ` text ${String(res.textDead).padStart(4)}/${String(res.textTotal).padEnd(5)}  ` +
      Object.entries(res.families).sort((a, b) => b[1] - a[1]).slice(0, 4)
        .map(([k, v]) => `${k}:${v}`).join("  ") + "\n");
  }
  await ctx.close();
}

// Pass 2: screenshots, both themes.
for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((t) => localStorage.setItem("signalera_theme", t), theme);
  const page = await ctx.newPage();
  await signIn(page);
  for (const r of SHOTS) {
    await page.goto(`${BASE}${r}`, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(1800);
    await page.evaluate(() => document.fonts.ready);
    const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    process.stdout.write(`shot ${r} ${theme} htmlDark=${isDark}\n`);
    await page.screenshot({ path: `${OUT}/${r.replace(/\//g, "")}-${theme}.png` });
  }
  await ctx.close();
}

writeFileSync(`${OUT}/results.json`, JSON.stringify(results));
await browser.close();

import { chromium, signedInContext } from "./auth.mjs";
const browser = await chromium.launch();
const { ctx, page } = await signedInContext(browser, { width: 390, height: 844 });
await page.goto("http://localhost:3203/evening-wrap", { waitUntil: "domcontentloaded" });
await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(4000);

const out = await page.evaluate(() => {
  const root = document.querySelector('[data-parity="evening"]');
  const LOADED = /Fraunces|Space Grotesk|IBM Plex Mono/;
  const ticker = root.querySelector('div[aria-hidden="true"][style*="30px"]')
    || [...root.children].find((c) => c.getAttribute("aria-hidden") === "true");
  const rows = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    if (!n.nodeValue || !n.nodeValue.trim()) continue;
    const el = n.parentElement;
    const ff = getComputedStyle(el).fontFamily;
    rows.push({
      ff,
      loaded: LOADED.test(ff),
      inTicker: !!(ticker && ticker.contains(el)),
      inAnatomy: !!el.closest('[class*="anatomy"], [id="evening-reviewed-inert"]'),
      tag: el.tagName,
      len: n.nodeValue.trim().length,
    });
  }
  const tally = {};
  for (const r of rows) {
    const key = `${r.loaded ? "LOADED" : "UNLOADED"} | ${r.ff} | ${r.inTicker ? "tickerStrip" : "screen"}`;
    tally[key] = (tally[key] || 0) + 1;
  }
  // for unloaded, non-ticker nodes, show a structural fingerprint
  const strays = rows.filter((r) => !r.loaded && !r.inTicker).map((r) => ({ ff: r.ff, tag: r.tag, len: r.len }));
  return { total: rows.length, tally, strays, tickerFound: !!ticker };
});
console.log(JSON.stringify(out, null, 2));
await ctx.close(); await browser.close();

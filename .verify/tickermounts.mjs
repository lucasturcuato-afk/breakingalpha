import { chromium, signedInContext } from "./auth.mjs";
const browser = await chromium.launch();
const { ctx, page } = await signedInContext(browser, { width: 390, height: 844 });
await ctx.addInitScript(() => {
  window.__tickerMounts = 0;
  window.__seen = new WeakSet();
  const tick = () => {
    for (const el of document.querySelectorAll('div[aria-hidden="true"]')) {
      if (el.style && el.style.height === "30px" && !window.__seen.has(el)) { window.__seen.add(el); window.__tickerMounts++; }
    }
  };
  new MutationObserver(tick).observe(document.documentElement, { childList: true, subtree: true });
});
const reqs = [];
page.on("request", (r) => { if (/symbols=SPY,NVDA,CEG/.test(r.url())) reqs.push(Date.now()); });
await page.goto("http://localhost:3203/evening-wrap", { waitUntil: "domcontentloaded" });
await page.waitForSelector("main", { state: "attached", timeout: 60000 });
await page.waitForTimeout(8000);
console.log(JSON.stringify({ tickerElementsEverInserted: await page.evaluate(() => window.__tickerMounts), tickerPolls: reqs.length }));
await ctx.close(); await browser.close();

import { chromium, signedInContext } from "./auth.mjs";
const browser = await chromium.launch();
const { ctx, page } = await signedInContext(browser, { width: 1440, height: 900 });
console.log("after auth url:", page.url());
await page.goto("http://localhost:3203/evening-wrap", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(8000);
console.log("url:", page.url());
console.log(await page.evaluate(() => ({
  bodyLen: document.body.innerText.length,
  head: document.body.innerText.slice(0, 200),
  mains: document.querySelectorAll("main").length,
  parity: !!document.querySelector('[data-parity="evening"]'),
  hiddenDivs: document.querySelectorAll('div.md\\:hidden').length,
  contentsDivs: document.querySelectorAll('div.hidden').length,
})));
await ctx.close(); await browser.close();

import { chromium, signedInContext } from "./auth.mjs";
const browser = await chromium.launch();
for (const w of [390, 1440]) {
  const { ctx, page } = await signedInContext(browser, { width: w, height: 900 });
  const t0 = Date.now();
  const reqs = [];
  page.on("request", (r) => reqs.push([Date.now() - t0, r.url()]));
  await page.goto("http://localhost:3203/evening-wrap", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("main", { state: "attached", timeout: 60000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(6000);
  const api = reqs.filter(([, u]) => /\/api\/|rest\/v1/.test(u));
  console.log(`\n===== ${w} : ${reqs.length} total requests, ${api.length} data requests`);
  for (const [t, u] of api) console.log(String(t).padStart(6), u.replace(/https:\/\/[^/]+/, "SUPA").replace(/(select=)[^&]*/, "$1…").slice(0, 150));
  await ctx.close();
}
await browser.close();

import { chromium, signedInContext } from "./auth.mjs";
const browser = await chromium.launch();
for (const w of [375, 390, 430, 768, 1440]) {
  const { ctx, page } = await signedInContext(browser, { width: w, height: 900 });
  const reqs = [];
  page.on("request", (r) => reqs.push(r.url()));
  await page.goto("http://localhost:3203/evening-wrap", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("main", { state: "attached", timeout: 60000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(5000);
  const o = await page.evaluate(() => {
    const root = document.querySelector('[data-parity="evening"]');
    const wrap = root ? root.parentElement : null;
    const desk = document.querySelector("div.hidden.md\\:contents");
    const r = root ? root.getBoundingClientRect() : null;
    const rows = root ? [...root.querySelectorAll("p")].length : 0;
    // mover rows: 46px mono column
    const movers = root ? [...root.querySelectorAll("span")].filter((s) => s.style.width === "46px")
      .map((s) => (s.textContent || "").trim()) : [];
    return {
      root: !!root,
      rootBox: r ? [Math.round(r.width), Math.round(r.height)] : null,
      wrapDisplay: wrap ? getComputedStyle(wrap).display : null,
      deskDisplay: desk ? getComputedStyle(desk).display : null,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      movers, pCount: rows,
      docNodes: document.querySelectorAll("*").length,
    };
  });
  const mine = reqs.filter((u) => /morning_brief_calls\?select=id%2Cclaim_text%2Ctarget_symbol%2Cresolve_on|symbols=SPY,NVDA,CEG/.test(u) || /watchlist-quotes\?symbols=[A-Z.]{1,6}$/.test(u));
  console.log(w, JSON.stringify({ ...o, mobileOnlyReqs: mine.length, mobileOnlyReqUrls: mine.map((u) => u.replace(/https:\/\/[^/]+/, "SUPA").slice(0, 120)) }));
  await ctx.close();
}
await browser.close();

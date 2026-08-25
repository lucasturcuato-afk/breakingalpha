import { chromium, signedInContext } from "./auth.mjs";
const browser = await chromium.launch();
const { ctx, page } = await signedInContext(browser, { width: 1440, height: 900 });
const reqs = [];
page.on("request", (r) => reqs.push(r.url()));
await page.goto("http://localhost:3203/evening-wrap", { waitUntil: "domcontentloaded" });
await page.waitForSelector("main", { timeout: 60000 });
await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(8000);
console.log("url", page.url());

const box = await page.evaluate(() => {
  const root = document.querySelector('[data-parity="evening"]');
  const desk = document.querySelector("div.hidden.md\\:contents");
  const main = document.querySelector("main");
  const rows = [];
  if (main) {
    const walk = (el, d) => {
      const r = el.getBoundingClientRect();
      rows.push([d, el.tagName, Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height), getComputedStyle(el).display].join("|"));
      for (const c of el.children) walk(c, d + 1);
    };
    walk(main, 0);
  }
  return {
    parityRoot: !!root,
    rootBox: root ? [Math.round(root.getBoundingClientRect().width), Math.round(root.getBoundingClientRect().height)] : null,
    rootDisplayParent: root ? getComputedStyle(root.parentElement).display : null,
    deskDisplay: desk ? getComputedStyle(desk).display : null,
    mainNodes: main ? main.querySelectorAll("*").length : null,
    boxRows: rows.length,
    boxTree: rows.join("\n"),
    fontsCheck: {
      plex: document.fonts.check("10px 'IBM Plex Mono'"),
      fraunces: document.fonts.check("25px Fraunces"),
      playfair: document.fonts.check("25px 'Playfair Display'"),
      inter: document.fonts.check("13px Inter"),
      jetbrains: document.fonts.check("10px 'JetBrains Mono'"),
    },
  };
});
const { boxTree, ...rest } = box;
import fs from "node:fs";
fs.writeFileSync("/tmp/claude-501/-Users-noahhanning-breakingalpha/0175a8d8-eef6-41a9-97e9-057150c6cc3f/scratchpad/boxtree-branch-1440.txt", boxTree);
const mine = reqs.filter((u) => /morning_brief_calls|watchlist-quotes/.test(u));
console.log(JSON.stringify({ ...rest, totalRequests: reqs.length, quoteAndCallReqs: mine }, null, 2));
await ctx.close(); await browser.close();

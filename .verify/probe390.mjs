import { chromium, signedInContext } from "./auth.mjs";

const browser = await chromium.launch();
const { ctx, page } = await signedInContext(browser, { width: 390, height: 844 });

const reqs = [];
page.on("request", (r) => reqs.push(r.url()));
await page.goto("http://localhost:3203/evening-wrap", { waitUntil: "domcontentloaded" });
await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(4000);

const out = await page.evaluate(() => {
  const root = document.querySelector('[data-parity="evening"]');
  const desk = document.querySelector("div.hidden.md\\:contents");
  const fam = {};
  let textNodes = 0;
  if (root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    let n;
    while ((n = walker.nextNode())) {
      if (!n.nodeValue || !n.nodeValue.trim()) continue;
      const el = n.parentElement;
      if (!el) continue;
      textNodes++;
      const f = getComputedStyle(el).fontFamily;
      fam[f] = (fam[f] || 0) + 1;
      seen.add(el);
    }
  }
  // the review-date sentence, and every rendered date-looking string
  const dateish = [];
  if (root) {
    for (const el of root.querySelectorAll("*")) {
      if (el.children.length) continue;
      const t = (el.textContent || "").trim();
      if (/January|February|March|April|May|June|July|August|September|October|November|December|\b\d{1,2}:\d{2}\b/.test(t)) dateish.push(t.slice(0, 160));
    }
  }
  const reviewedRest = [...(root ? root.querySelectorAll("p,div,span") : [])]
    .map((e) => (e.textContent || "").trim())
    .filter((t) => /still open|No other call/.test(t) && t.length < 200);
  return {
    parityRoot: !!root,
    parityDisplay: root ? getComputedStyle(root).display : null,
    rootBox: root ? [Math.round(root.getBoundingClientRect().width), Math.round(root.getBoundingClientRect().height)] : null,
    deskDisplay: desk ? getComputedStyle(desk).display : null,
    bodyWidth: document.body.clientWidth,
    textNodes,
    fam,
    dateish,
    reviewedRest: [...new Set(reviewedRest)],
    moverRows: [...(root ? root.querySelectorAll("*") : [])].length,
  };
});

const interesting = reqs.filter((u) => /watchlist-quotes|morning_brief_calls|rest\/v1/.test(u));
console.log(JSON.stringify({ ...out, interesting }, null, 2));

await ctx.close();
await browser.close();

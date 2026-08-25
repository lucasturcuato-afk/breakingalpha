import { chromium, signedInContext } from "./auth.mjs";
const browser = await chromium.launch();
const { ctx, page } = await signedInContext(browser, { width: 390, height: 844 });
await page.goto("http://localhost:3203/evening-wrap", { waitUntil: "domcontentloaded" });
await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(3000);
const out = await page.evaluate(() => {
  const root = document.querySelector('[data-parity="evening"]');
  const probe = document.createElement("span");
  probe.textContent = "Signalera evening wrap 0123456789";
  probe.style.cssText = "position:absolute;white-space:nowrap;visibility:hidden";
  root.appendChild(probe);
  const w = (font) => { probe.style.font = font; return probe.getBoundingClientRect().width.toFixed(2); };
  const r = {
    "800 25px 'Playfair Display', serif": w("800 25px 'Playfair Display', serif"),
    "800 25px serif": w("800 25px serif"),
    "800 25px var(--font-playfair-display), serif": w("800 25px var(--font-playfair-display), serif"),
    "400 10px 'JetBrains Mono', monospace": w("400 10px 'JetBrains Mono', monospace"),
    "400 10px monospace": w("400 10px monospace"),
    "400 10px var(--font-jetbrains-mono), monospace": w("400 10px var(--font-jetbrains-mono), monospace"),
    "400 13px Inter, sans-serif": w("400 13px Inter, sans-serif"),
    "400 13px sans-serif": w("400 13px sans-serif"),
    "400 13px var(--font-inter), sans-serif": w("400 13px var(--font-inter), sans-serif"),
  };
  probe.remove();
  return r;
});
console.log(JSON.stringify(out, null, 2));
await ctx.close(); await browser.close();

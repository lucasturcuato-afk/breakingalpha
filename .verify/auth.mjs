import { chromium } from "playwright";
import fs from "node:fs";

const env = Object.fromEntries(
  fs.readFileSync("/Users/noahhanning/breakingalpha-wt/fin-commentary/.env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);

export async function signedInContext(browser, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto("http://localhost:3203/auth", { waitUntil: "domcontentloaded" });
  const form = page.locator("form:visible").first();
  await form.locator('input[type="email"]').fill(env.E2E_USER_EMAIL);
  await form.locator('input[type="password"]').fill(env.E2E_USER_PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 60000 }),
    form.locator('button[type="submit"]').click(),
  ]);
  await page.waitForLoadState("networkidle").catch(() => {});
  return { ctx, page };
}

export { chromium, env };

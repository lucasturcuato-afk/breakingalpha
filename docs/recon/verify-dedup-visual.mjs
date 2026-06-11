import { chromium } from "playwright";

const BASE = "http://localhost:3137";

// Minimal TopStoryRow factory.
const row = (o) => ({
  id: o.id,
  title: o.title,
  source: o.source,
  summary: o.summary ?? o.title,
  content: o.content ?? o.title,
  sector: o.sector ?? "Financials",
  industry_verticals: o.industry_verticals ?? [],
  activity_types: o.activity_types ?? [],
  sentiment: o.sentiment ?? "neutral",
  published_at: o.published_at,
  ingested_at: o.ingested_at ?? o.published_at,
  url: o.url ?? "https://example.com/" + o.id,
  companies: o.companies ?? [],
  relevance_score: o.relevance_score,
});

// CASE A - collapse: the real VCTR same-event pair (Stock Titan + GuruFocus),
// both score 10, adjacent at the top, then three distinct fillers.
const FIXTURE_COLLAPSE = [
  row({ id: "vctr-stocktitan", title: "Victory Capital (NASDAQ: VCTR) reports $338.9B May assets under management - Stock Titan", source: "Google News (VCTR)", relevance_score: 10, published_at: "2026-06-09T12:22:32Z", companies: ["Victory Capital"] }),
  row({ id: "vctr-gurufocus", title: "Victory Capital (VCTR) Reports Strong Assets Under Management - GuruFocus", source: "Google News (VCTR)", relevance_score: 10, published_at: "2026-06-09T12:03:30Z", companies: ["Victory Capital"] }),
  row({ id: "nvda-1", title: "Nvidia (NVDA) Unveils Next-Gen Data Center GPU at Computex - Reuters", source: "Google News (NVDA)", relevance_score: 10, published_at: "2026-06-09T11:40:00Z", companies: ["Nvidia"] }),
  row({ id: "aapl-1", title: "Apple (AAPL) Opens WWDC With On-Device AI Push - Bloomberg", source: "Google News (AAPL)", relevance_score: 10, published_at: "2026-06-09T11:10:00Z", companies: ["Apple"] }),
  row({ id: "msft-1", title: "Microsoft (MSFT) Lands $10B Government Cloud Contract - CNBC", source: "Google News (MSFT)", relevance_score: 10, published_at: "2026-06-09T10:30:00Z", companies: ["Microsoft"] }),
  row({ id: "amzn-1", title: "Amazon (AMZN) Expands Same-Day Pharmacy to 20 Cities - WSJ", source: "Google News (AMZN)", relevance_score: 9, published_at: "2026-06-09T09:50:00Z", companies: ["Amazon"] }),
];

// CASE B - control: two DISTINCT VCTR stories (May AUM report vs the Janus
// Henderson bid, Jaccard ~0.1) plus fillers. These must BOTH survive.
const FIXTURE_CONTROL = [
  row({ id: "vctr-aum", title: "Victory Capital (NASDAQ: VCTR) reports $338.9B May assets under management - Stock Titan", source: "Google News (VCTR)", relevance_score: 10, published_at: "2026-06-09T12:22:32Z", companies: ["Victory Capital"] }),
  row({ id: "vctr-janus", title: "Is Victory Capital's New Bid a Game Changer for Janus Henderson - Kavout", source: "Google News (VCTR)", relevance_score: 10, published_at: "2026-06-09T10:03:26Z", companies: ["Victory Capital"] }),
  row({ id: "nvda-2", title: "Nvidia (NVDA) Unveils Next-Gen Data Center GPU at Computex - Reuters", source: "Google News (NVDA)", relevance_score: 10, published_at: "2026-06-09T11:40:00Z", companies: ["Nvidia"] }),
  row({ id: "aapl-2", title: "Apple (AAPL) Opens WWDC With On-Device AI Push - Bloomberg", source: "Google News (AAPL)", relevance_score: 9, published_at: "2026-06-09T11:10:00Z", companies: ["Apple"] }),
];

async function shoot(fixture, outfile, label) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 1400 } });
  const page = await ctx.newPage();

  await ctx.route(/\/rest\/v1\/articles/i, async (route) => {
    const url = route.request().url();
    if (/relevance_score/i.test(url)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixture) });
    }
    // the "Signals Today" count query (select=id, head)
    return route.fulfill({ status: 206, headers: { "content-range": "0-0/1234", "content-type": "application/json" }, body: "[]" });
  });

  await page.goto(BASE + "/preview", { waitUntil: "domcontentloaded", timeout: 60000 });
  // Wait for the Top Stories heading and at least one rendered card.
  await page.getByText("Top Stories", { exact: false }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(2500);

  // Extract the rendered story titles for a text assertion in the log.
  const titles = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll("a[href^='https://example.com/'], a[href*='google'], h3, h2").forEach((e) => {
      const t = (e.textContent || "").trim();
      if (t.length > 20) out.push(t);
    });
    return out;
  });
  console.log("\n=== " + label + " rendered titles ===");
  console.log(JSON.stringify(titles, null, 2));

  await page.screenshot({ path: outfile, fullPage: true });
  console.log("screenshot -> " + outfile);
  await browser.close();
}

await shoot(FIXTURE_COLLAPSE, "docs/recon/dedup-collapse-preview.png", "CASE A (collapse)");
await shoot(FIXTURE_CONTROL, "docs/recon/dedup-control-distinct-preview.png", "CASE B (control)");
console.log("\nDONE");

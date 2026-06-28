/**
 * Read-only Exa pool fetcher for the web-memo anti-fabrication recon.
 *
 * Replicates the PRODUCT path exactly so the pool the POCs analyze is the same
 * pool the live memo was generated from:
 *   src/lib/web-search.ts  -> fetchExa() + dedupe()  (params copied verbatim)
 *   src/app/api/companies/web-fallback/route.ts -> searchQuery = `${q} company news`, limit 8
 *
 * Read-only: GET-equivalent POST to Exa /search. No product file imported, no
 * write to web_search_cache, no Supabase touch. Key loaded from the main repo
 * .env.local (never printed).
 *
 * Usage: node fetch-pool.mjs "Klaviyo" kvyo
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = "/Users/noahhanning/breakingalpha/.env.local";

function loadKey() {
  const txt = readFileSync(ENV_PATH, "utf8");
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^EXA_API_KEY\s*=\s*(.+)$/);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  throw new Error("EXA_API_KEY not found in .env.local");
}

// --- verbatim copies of product helpers (src/lib/web-search.ts) ---
function canonicalUrl(raw) {
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    u.protocol = "https:";
    const tracking = ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","gclid","fbclid","mc_cid","mc_eid","ref","ref_src","_hsenc","_hsmi"];
    for (const p of tracking) u.searchParams.delete(p);
    u.hash = "";
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.replace(/\/+$/, "");
    if ((u.protocol === "https:" && u.port === "443") || (u.protocol === "http:" && u.port === "80")) u.port = "";
    return u.toString();
  } catch {
    return raw.replace(/\/+$/, "");
  }
}
function extractDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}
function extractLeadingEntity(title) {
  if (!title) return "";
  const cut = title.split(/[:|—–\-•,]/)[0].trim();
  return cut.split(/\s+/).slice(0, 5).join(" ");
}
// canonicalize() is a product import; for dedup-key purposes we approximate it
// with a lowercase alnum-collapse. Dedup only affects which of two near-identical
// rows survives, not the figure/claim content the POCs test, so this is faithful.
function canonicalizeApprox(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function dedupe(results) {
  const byUrl = new Map();
  for (const r of results) if (!byUrl.has(r.url)) byUrl.set(r.url, r);
  const byName = new Map();
  for (const r of byUrl.values()) {
    const leading = extractLeadingEntity(r.title);
    const canonical = leading ? canonicalizeApprox(leading) : "";
    const key = canonical.length >= 3 ? `name:${canonical}` : `url:${r.url}`;
    if (!byName.has(key)) byName.set(key, r);
  }
  return Array.from(byName.values());
}

async function fetchExa(query, limit, apiKey) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const requestCount = Math.min(Math.max(limit * 2, 10), 25);
  const resp = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      type: "auto",
      category: "news",
      numResults: requestCount,
      startPublishedDate: thirtyDaysAgo,
      contents: { highlights: { maxCharacters: 400, numSentences: 3 } },
    }),
  });
  if (!resp.ok) throw new Error(`Exa returned ${resp.status}`);
  const raw = await resp.json();
  const items = raw.results ?? [];
  return items.map((item) => {
    const url = canonicalUrl(item.url ?? "");
    if (!url) return null;
    const title = (item.title ?? "").trim();
    if (title.length < 8) return null;
    const highlights = item.highlights ?? [];
    const summary = highlights.length > 0 ? highlights.join(" ") : (item.text ?? "").slice(0, 400);
    return { url, title, summary: summary.trim(), source: extractDomain(url) || (item.author ?? "Web"), publishedAt: item.publishedDate ?? null };
  }).filter(Boolean);
}

async function main() {
  const query = process.argv[2];
  const slug = process.argv[3] || canonicalizeApprox(query).replace(/\s+/g, "-");
  if (!query) { console.error("usage: node fetch-pool.mjs <query> [slug]"); process.exit(1); }
  const apiKey = loadKey();
  const searchQuery = `${query} company news`; // product disambiguation suffix
  const fresh = await fetchExa(searchQuery, 8, apiKey);
  const deduped = dedupe(fresh).slice(0, 8); // product: searchWeb(..., 8)
  const out = join(__dirname, "pools", `${slug}.json`);
  writeFileSync(out, JSON.stringify({ query, searchQuery, fetchedAt: new Date().toISOString(), count: deduped.length, results: deduped }, null, 2));
  console.log(`\n=== POOL for "${query}" (${deduped.length} on-pool results, pre entity-filter) ===\n`);
  deduped.forEach((r, i) => {
    console.log(`[${i + 1}] ${r.title}`);
    console.log(`    ${r.source} | ${r.publishedAt ? r.publishedAt.slice(0, 10) : "no-date"}`);
    console.log(`    ${r.summary.slice(0, 320)}`);
    console.log("");
  });
  console.log(`saved -> ${out}`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });

/**
 * Read-only probe: does the web-fallback entity filter anchor on a COLLAPSED
 * subject token, letting other-same-token companies pass as on-entity?
 *
 * Uses the REAL product modules (no reimplementation of the logic under test):
 *   - normalizeFromResults      (src/app/api/companies/web-fallback/normalize.ts)
 *   - subjectForClassification  (src/lib/web-memo-entity.ts)
 *   - classifyWebResults        (src/lib/web-memo-entity.ts)
 * and the REAL route wiring (route.ts:127/141/142): the filter matches on
 * classifySubject = subjectForClassification(canonicalName, heuristicGuess),
 * while canonicalName is only a payload/display field.
 *
 * Read-only: fetches the real Exa pool with product params (mirrors
 * src/lib/web-search.ts fetchExa) but performs NO write (no web_search_cache,
 * no /api/memo, no Supabase). EXA_API_KEY read from the main repo .env.local.
 */
import { readFileSync } from "node:fs";
import { normalizeFromResults } from "../src/app/api/companies/web-fallback/normalize.ts";
import { subjectForClassification, classifyWebResults } from "../src/lib/web-memo-entity.ts";
import type { SearchResult } from "../src/lib/web-search.ts";

// Mirror of web-memo-entity.ts GENERIC_TOKENS, for the match-reason explainer only.
const GENERIC = new Set(["the","inc","incorporated","corp","corporation","co","company","companies","ltd","limited","plc","group","holding","holdings","sa","ag","nv","ab","lp","llc","bancorp","bancshares","bank","banks","financial","international","intl","technologies","technology","systems","industries","capital","partners","enterprises","enterprise","services","solutions","global","ltd."]);

const ENV = "/Users/noahhanning/breakingalpha/.env.local";
function exaKey(): string {
  for (const line of readFileSync(ENV, "utf8").split(/\r?\n/)) {
    const m = line.match(/^EXA_API_KEY\s*=\s*(.+)$/);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  throw new Error("no EXA_API_KEY");
}

// --- product-faithful pool build (src/lib/web-search.ts fetchExa, params verbatim) ---
function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.protocol = "https:";
    for (const p of ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","gclid","fbclid","mc_cid","mc_eid","ref","ref_src","_hsenc","_hsmi"]) u.searchParams.delete(p);
    u.hash = "";
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString();
  } catch { return raw; }
}
function domain(url: string): string { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } }

async function fetchPool(query: string, apiKey: string): Promise<SearchResult[]> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const resp = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ query, type: "auto", category: "news", numResults: 16, startPublishedDate: thirtyDaysAgo, contents: { highlights: { maxCharacters: 400, numSentences: 3 } } }),
  });
  if (!resp.ok) throw new Error(`Exa ${resp.status}`);
  const raw = await resp.json() as { results?: Array<Record<string, unknown>> };
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const item of raw.results ?? []) {
    const url = canonicalUrl((item.url as string) ?? "");
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const title = ((item.title as string) ?? "").trim();
    if (title.length < 8) continue;
    const highlights = (item.highlights as string[]) ?? [];
    const summary = highlights.length ? highlights.join(" ") : ((item.text as string) ?? "").slice(0, 400);
    out.push({ url, title, summary: summary.trim(), source: domain(url) || "Web", publishedAt: (item.publishedDate as string) ?? null });
    if (out.length >= 8) break; // product: searchWeb(..., 8)
  }
  return out;
}

// bestGuessCanonical, copied verbatim from web-fallback/route.ts (the heuristicGuess input)
function bestGuessCanonical(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return "";
  const cleaned = trimmed.replace(/\s+(company\s+news|news|inc|corp|ltd)$/i, "").trim();
  const tokens = cleaned.split(/\s+/);
  let bestRun: string[] = [], currentRun: string[] = [];
  for (const t of tokens) {
    if (/^[A-Z][A-Za-z0-9.&'-]*$/.test(t)) { currentRun.push(t); if (currentRun.length > bestRun.length) bestRun = [...currentRun]; }
    else currentRun = [];
  }
  if (bestRun.length > 0) return bestRun.join(" ");
  return cleaned.split(/\s+/).map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)).join(" ");
}

// The test set: {query as a user would type it, ticker}
const CASES: Array<{ query: string; ticker: string }> = [
  { query: "Klaviyo", ticker: "KVYO" },
  { query: "Lake Shore Bancorp", ticker: "LSBK" },
  { query: "Unum Group", ticker: "UNM" },
  { query: "First Keystone", ticker: "FKYS" },
  { query: "United Security Bancshares", ticker: "UBFO" },
  { query: "Citizens Community Bancorp", ticker: "CZWI" },
  { query: "Apple", ticker: "AAPL" },
  { query: "JPMorgan", ticker: "JPM" },
];

async function main() {
  const apiKey = exaKey();
  for (const c of CASES) {
    const searchQuery = `${c.query} company news`;   // route.ts:105
    let pool: SearchResult[];
    try { pool = await fetchPool(searchQuery, apiKey); }
    catch (e) { console.log(`\n##### ${c.ticker} (${c.query}) -> FETCH FAILED: ${(e as Error).message}`); continue; }

    const heuristicGuess = bestGuessCanonical(c.query);                 // route.ts:110
    const canonicalName = normalizeFromResults(c.query, pool, heuristicGuess); // route.ts:127
    const classifySubject = subjectForClassification(canonicalName, heuristicGuess); // route.ts:141
    const { onEntity, sectorContext } = classifyWebResults({ canonical: classifySubject, ticker: c.ticker }, pool); // route.ts:142

    console.log(`\n##### ${c.ticker} (query "${c.query}") #####`);
    console.log(`  canonicalName (display/payload) : "${canonicalName}"`);
    console.log(`  heuristicGuess (query-derived)  : "${heuristicGuess}"`);
    console.log(`  classifySubject (FILTER MATCH KEY): "${classifySubject}"   <-- what on-entity actually compares against`);
    console.log(`  onEntityCount=${onEntity.length}  sectorContext=${sectorContext.length}  poolSize=${pool.length}`);
    // Explain WHY each on-entity row matched: recompute the match signal against
    // classifySubject so the reason is code-derived, not inferred from the title.
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
    const sig = norm(classifySubject).split(" ").filter((t) => t.length >= 2 && !GENERIC.has(t));
    const tick = norm(c.ticker);
    const onSet = new Set(onEntity);
    pool.forEach((r) => {
      const hay = norm(`${r.title} ${r.summary}`);
      let reason = "";
      if (onSet.has(r)) {
        if (sig.some((t) => t.length >= 6 && hay.includes(t))) reason = "substr>=6";
        else if (sig.length >= 2 && hay.includes(`${sig[0]} ${sig[1]}`)) reason = "bigram";
        else if (sig.length === 1 && ` ${hay} `.includes(` ${sig[0]} `)) reason = "1-token";
        else if (sig.length >= 2 && sig.every((t) => ` ${hay} `.includes(` ${t} `))) reason = "all-tokens(common-word leak?)";
        else if (tick && ` ${norm(r.title)} `.includes(` ${tick} `)) reason = "ticker-in-title";
        else reason = "?";
      }
      console.log(`    [${onSet.has(r) ? "ON " : "ctx"}]${reason ? ` (${reason})` : ""} ${r.title.slice(0, 76)}`);
    });
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

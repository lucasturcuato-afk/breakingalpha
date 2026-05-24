// WD129 dry-test harness.
// Pulls the SpaceX corpus (read-only), runs BOTH the old recency-only
// selection AND the new facet-protected selection, and reports a side-by-side
// pool comparison plus the three headline questions:
//   1. Is the dual-class governance article in the pool?
//   2. Is any article carrying the $1.75T range in the pool?
//   3. Is any sentiment='bearish' article in the pool?

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE env. Need NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const ARTICLE_COLUMNS =
  "id, title, source, sector, sentiment, summary, content, published_at, ingested_at, url, companies, primary_company, relevance_score, deal_type";

const POOL_SIZE = 10;
const MIN_RELEVANCE = 6;
const FACET_WINDOW_DAYS = 30;
const FILLER_WINDOW_DAYS = 14;

// === MIRROR of selection logic in src/app/api/companies/[id]/articles/route.ts ===

const FACETS = ["governance", "bear", "financial-risk", "valuation-range"];

const GOVERNANCE_RE =
  /\b(dual[- ]class|class\s+[ab]\b|supervoting|super[- ]voting|voting\s+(power|control|rights)|85\.1|proxy(\s+fight)?|board\s+(control|seats?)|governance|monarchical|tight\s+grip|complete\s+control)\b/i;
const BEAR_KEYWORD_RE =
  /\b(overvalued|hard\s+to\s+justify|skeptical|bear\s+case|bearish|frothy|paradox|money-losing|behemoth|warned|scrub|billion\s+loss|biggest\s+threat|not\s+buying)\b/i;
const FIN_RISK_RE =
  /\b(bridge\s+loan|dilution|cash\s+burn|going\s+concern|runway|down\s+round|debt\s+covenant|default(?!\s+(rate|to))|liquidity\s+(risk|crunch)|negative\s+cash\s+flow|losing\s+money|lost\s+\$[\d.]+\s*billion)\b/i;
const RANGE_RE =
  /\$\d[\d,.]*\s*(billion|trillion|[bt])\b[\s\S]{0,40}(to|-|–|—)\s*\$\d[\d,.]*\s*(billion|trillion|[bt])\b/i;
const RANGE_ALT_RE = /\$1\.75\s*(trillion|t)\b/i;

const txt = (a) => [a.title ?? "", a.summary ?? "", a.content ?? ""].join(" ");

function matchesFacet(facet, a) {
  const t = txt(a);
  switch (facet) {
    case "governance": return GOVERNANCE_RE.test(t);
    case "bear": return a.sentiment === "bearish" || BEAR_KEYWORD_RE.test(t);
    case "financial-risk": return FIN_RISK_RE.test(t);
    case "valuation-range": return RANGE_RE.test(t) || RANGE_ALT_RE.test(t);
  }
}

function byRelRecency(a, b) {
  const ra = a.relevance_score ?? 0;
  const rb = b.relevance_score ?? 0;
  if (rb !== ra) return rb - ra;
  const ta = a.published_at ? new Date(a.published_at).getTime() : 0;
  const tb = b.published_at ? new Date(b.published_at).getTime() : 0;
  return tb - ta;
}

function selectFacetProtectedPool(facetWindow, fillerWindow, poolSize = POOL_SIZE) {
  const pool = [];
  const seen = new Set();
  const facetAttribution = {};

  for (const facet of FACETS) {
    const matches = facetWindow.filter((a) => matchesFacet(facet, a));
    if (matches.length === 0) continue;
    matches.sort(byRelRecency);
    for (const cand of matches) {
      if (!seen.has(cand.id)) {
        pool.push(cand);
        seen.add(cand.id);
        facetAttribution[cand.id] = facet;
        break;
      }
    }
  }

  const filler = [...fillerWindow].sort(byRelRecency);
  for (const cand of filler) {
    if (pool.length >= poolSize) break;
    if (seen.has(cand.id)) continue;
    pool.push(cand);
    seen.add(cand.id);
  }
  if (pool.length < poolSize) {
    const facetFiller = [...facetWindow].sort(byRelRecency);
    for (const cand of facetFiller) {
      if (pool.length >= poolSize) break;
      if (seen.has(cand.id)) continue;
      pool.push(cand);
      seen.add(cand.id);
    }
  }
  return { pool, facetAttribution };
}

// === Harness ===

async function main() {
  const companyName = "SpaceX";

  // (a) Legacy: ORDER BY ingested_at DESC LIMIT 50 (then take top 10 for fair comparison)
  const { data: legacyRows, error: legacyErr } = await supabase
    .from("articles")
    .select(ARTICLE_COLUMNS)
    .contains("companies", [companyName])
    .order("ingested_at", { ascending: false })
    .limit(50);
  if (legacyErr) throw legacyErr;
  const legacyPool = (legacyRows ?? []).slice(0, POOL_SIZE);

  // (d) WD129: hybrid window facet-protected
  const now = Date.now();
  const facetCutoff = new Date(now - FACET_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const fillerCutoff = new Date(now - FILLER_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: facetRows, error: facetErr } = await supabase
    .from("articles")
    .select(ARTICLE_COLUMNS)
    .contains("companies", [companyName])
    .gte("published_at", facetCutoff)
    .gte("relevance_score", MIN_RELEVANCE)
    .order("published_at", { ascending: false })
    .limit(200);
  if (facetErr) throw facetErr;
  const facetWindow = facetRows ?? [];
  const fillerWindow = facetWindow.filter((a) => {
    const ts = a.published_at ?? a.ingested_at ?? null;
    return ts != null && ts >= fillerCutoff;
  });
  const { pool: newPool, facetAttribution } = selectFacetProtectedPool(facetWindow, fillerWindow, POOL_SIZE);

  // === Reporting ===

  const fmt = (a, attrib) => {
    const idShort = a.id.slice(0, 8);
    const date = (a.published_at ?? "").slice(0, 10);
    const tag = attrib?.[a.id] ? `[${attrib[a.id]}]` : "";
    const sent = a.sentiment ? `(${a.sentiment})` : "";
    return `${idShort} | r=${a.relevance_score ?? "?"} | ${date} | ${sent} ${tag} ${a.title?.slice(0, 90) ?? ""}`;
  };

  console.log("\n=== WD129 Dry-Test: SpaceX Memo Pool Selection ===\n");
  console.log(`Corpus window: facet 30d / filler 14d / now ${new Date(now).toISOString()}`);
  console.log(`Facet candidate count (30d, r>=6): ${facetWindow.length}`);
  console.log(`Filler candidate count (14d, r>=6): ${fillerWindow.length}`);

  console.log("\n--- Legacy selection (ORDER BY ingested_at DESC, top 10) ---");
  legacyPool.forEach((a, i) => console.log(`  ${(i + 1).toString().padStart(2)}. ${fmt(a)}`));

  console.log("\n--- WD129 facet-protected selection (top 10) ---");
  newPool.forEach((a, i) => console.log(`  ${(i + 1).toString().padStart(2)}. ${fmt(a, facetAttribution)}`));

  // Diff
  const legacyIds = new Set(legacyPool.map((a) => a.id));
  const newIds = new Set(newPool.map((a) => a.id));
  const dropped = legacyPool.filter((a) => !newIds.has(a.id));
  const added = newPool.filter((a) => !legacyIds.has(a.id));

  console.log(`\n--- Diff ---`);
  console.log(`  Dropped (in legacy, NOT in new): ${dropped.length}`);
  dropped.forEach((a) => console.log(`    - ${fmt(a)}`));
  console.log(`  Added (in new, NOT in legacy): ${added.length}`);
  added.forEach((a) => console.log(`    + ${fmt(a, facetAttribution)}`));

  // Headline questions
  const hasGov = (pool) => pool.some((a) => matchesFacet("governance", a));
  const hasRange = (pool) => pool.some((a) => matchesFacet("valuation-range", a));
  const hasBear = (pool) => pool.some((a) => a.sentiment === "bearish");

  // Specific article checks called out in the design brief.
  const TECHCRUNCH_GOV_ID = "4c1f0d39"; // partial id prefix
  const hasTechCrunchGov = (pool) => pool.some((a) => a.id.startsWith(TECHCRUNCH_GOV_ID));

  const lineY = (b) => (b ? "YES" : "NO");
  console.log("\n--- HEADLINE ANSWERS ---");
  console.log("                                    LEGACY  ->  NEW (WD129)");
  console.log(`  Governance article in pool?       ${lineY(hasGov(legacyPool)).padEnd(6)}  ->  ${lineY(hasGov(newPool))}`);
  console.log(`  TechCrunch 4c1f0d39 in pool?      ${lineY(hasTechCrunchGov(legacyPool)).padEnd(6)}  ->  ${lineY(hasTechCrunchGov(newPool))}`);
  console.log(`  $1.75T / range carrier in pool?   ${lineY(hasRange(legacyPool)).padEnd(6)}  ->  ${lineY(hasRange(newPool))}`);
  console.log(`  Bearish sentiment article in pool?${lineY(hasBear(legacyPool)).padEnd(6)}  ->  ${lineY(hasBear(newPool))}`);

  // Per-facet attribution detail
  console.log("\n--- Facet attribution (WD129 protected slots) ---");
  for (const f of FACETS) {
    const picks = newPool.filter((a) => facetAttribution[a.id] === f);
    if (picks.length === 0) {
      const anyMatch = facetWindow.some((a) => matchesFacet(f, a));
      console.log(`  ${f}: (no protected pick) ${anyMatch ? "[candidates exist but lost to earlier facet]" : "[zero matches in 30d window]"}`);
    } else {
      picks.forEach((a) => console.log(`  ${f}: ${fmt(a)}`));
    }
  }

  console.log("\n--- All facet matches in 30d window (informational) ---");
  for (const f of FACETS) {
    const matches = facetWindow.filter((a) => matchesFacet(f, a));
    matches.sort(byRelRecency);
    console.log(`  ${f}: ${matches.length} match(es)`);
    matches.slice(0, 5).forEach((a) => console.log(`    - ${fmt(a)}`));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

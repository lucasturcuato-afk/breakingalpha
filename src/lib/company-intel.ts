/**
 * company-intel.ts — shared pure logic for the Company Intel feature.
 *
 * All exports are framework-agnostic (no React, no Next.js, no Supabase).
 * Both the list page (client component) and the detail page (server component)
 * import from here to avoid divergent copies of canonicalization, matching,
 * development classification, and memo-building logic.
 */

import { stripHtml } from "@/lib/strip-html";
import { isFacetProtected, facetMatchSpans, type FacetSpan } from "@/lib/facet-predicates";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompanyArticle {
  id: string;
  title: string;
  source?: string;
  sector?: string;
  sentiment?: string;
  summary?: string;
  content?: string | null;
  published_at?: string;
  url?: string;
  primary_company?: string | null;
  relevance_score?: number;
  deal_type?: string | null;
  // True when the article describes a company-specific event (earnings, funding, M&A, IPO).
  // Distinct from "company is primary subject" — a geopolitical story where NVIDIA is the
  // primary subject is NOT a development.
  _isDevelopment: boolean;
}

export interface CompanyIdentity {
  industry: string;
  brief: string;
}

// Raw article row shape from Supabase — the subset we select in article queries.
export interface RawArticleRow {
  id: string;
  title: string;
  source?: string | null;
  sector?: string | null;
  sentiment?: string | null;
  summary?: string | null;
  // WD130: `content` is selected by ARTICLE_COLUMNS in the company-articles
  // route but was previously dropped at the type layer, which meant
  // formatArticleList only ever saw `summary`. Carrying it through here lets
  // the memo prompt feed full article text when available.
  content?: string | null;
  published_at?: string | null;
  ingested_at?: string | null;
  url?: string | null;
  companies?: unknown;
  primary_company?: string | null;
  relevance_score?: number | null;
  deal_type?: string | null;
}

// ---------------------------------------------------------------------------
// Canonical name map
// ---------------------------------------------------------------------------
// Keys are lowercase variants, value is the preferred display name.
// Handles renames (google→Alphabet), short forms (goldman→Goldman Sachs),
// legal-suffix variants resolved after suffix stripping, and slug→name
// resolution for the detail route (openai→OpenAI, spacex→SpaceX, etc.).

export const CANONICAL: Record<string, string> = {
  // NVIDIA
  nvidia: "NVIDIA",
  "nvidia corporation": "NVIDIA",
  "nvidia corp": "NVIDIA",
  // Alphabet / Google
  alphabet: "Alphabet",
  "alphabet inc": "Alphabet",
  "alphabet inc.": "Alphabet",
  google: "Alphabet",
  "google llc": "Alphabet",
  "google inc": "Alphabet",
  // Meta / Facebook
  meta: "Meta",
  "meta platforms": "Meta",
  "meta platforms inc": "Meta",
  "meta platforms, inc.": "Meta",
  facebook: "Meta",
  // Amazon
  "amazon.com": "Amazon",
  "amazon.com inc": "Amazon",
  "amazon.com, inc.": "Amazon",
  amazon: "Amazon",
  // Apple
  "apple inc": "Apple",
  "apple inc.": "Apple",
  apple: "Apple",
  // Microsoft
  "microsoft corporation": "Microsoft",
  "microsoft corp": "Microsoft",
  microsoft: "Microsoft",
  // JPMorgan Chase
  "jpmorgan chase": "JPMorgan Chase",
  "jpmorgan chase & co": "JPMorgan Chase",
  "jp morgan": "JPMorgan Chase",
  jpmorgan: "JPMorgan Chase",
  // Goldman Sachs
  "goldman sachs": "Goldman Sachs",
  "goldman sachs group": "Goldman Sachs",
  "the goldman sachs group": "Goldman Sachs",
  goldman: "Goldman Sachs",
  // Berkshire Hathaway
  "berkshire hathaway": "Berkshire Hathaway",
  "berkshire hathaway inc": "Berkshire Hathaway",
  // Marvell
  marvell: "Marvell Technology",
  "marvell technology": "Marvell Technology",
  // Lockheed Martin
  lockheed: "Lockheed Martin",
  "lockheed martin": "Lockheed Martin",
  "lockheed martin corporation": "Lockheed Martin",
  // Whoop
  whoop: "Whoop",
  // Arm Holdings
  arm: "Arm Holdings",
  "arm holdings": "Arm Holdings",
  // Samsung
  "samsung electronics": "Samsung",
  "samsung electronics co": "Samsung",
  // SoftBank
  softbank: "SoftBank",
  "softbank group": "SoftBank",
  // Foxconn / Hon Hai
  foxconn: "Foxconn",
  "hon hai": "Foxconn",
  "hon hai precision": "Foxconn",
  "hon hai precision industry": "Foxconn",
  // Additional entries for slug → name resolution on the detail page.
  // These fix casing that title-case conversion cannot reconstruct from a lowercase slug.
  openai: "OpenAI",
  spacex: "SpaceX",
  xai: "xAI",
  tiktok: "TikTok",
  kkr: "KKR",
  tpg: "TPG",
  techcrunch: "TechCrunch",
  exxonmobil: "ExxonMobil",
  "anthropic pbc": "Anthropic",
  // Watchlist tickers — explicit list per fix plan Phase 1C
  hood: "Robinhood",
  robinhood: "Robinhood",
  "robinhood markets": "Robinhood",
  "robinhood markets inc": "Robinhood",
  sofi: "SoFi",
  "sofi technologies": "SoFi",
  "sofi technologies inc": "SoFi",
  coin: "Coinbase",
  coinbase: "Coinbase",
  "coinbase global": "Coinbase",
  "coinbase global inc": "Coinbase",
  shop: "Shopify",
  shopify: "Shopify",
  "shopify inc": "Shopify",
  // Boeing ticker BA intentionally NOT added as canonical — too generic, high false-positive risk
  boeing: "Boeing",
  "the boeing company": "Boeing",
  "boeing co": "Boeing",
  crwd: "CrowdStrike",
  crowdstrike: "CrowdStrike",
  "crowdstrike holdings": "CrowdStrike",
  "crowdstrike holdings inc": "CrowdStrike",
  uber: "Uber",
  "uber technologies": "Uber",
  "uber technologies inc": "Uber",
  ionq: "IonQ",
  "ionq inc": "IonQ",
  asts: "AST SpaceMobile",
  "ast spacemobile": "AST SpaceMobile",
  "ast spacemobile inc": "AST SpaceMobile",
  rklb: "Rocket Lab",
  "rocket lab": "Rocket Lab",
  "rocket lab usa": "Rocket Lab",
  "rocket lab usa inc": "Rocket Lab",
  ndaq: "Nasdaq",
  // "nasdaq" key intentionally NOT added — collides with INDEX_BLOCKLIST and the
  // exchange-as-index meaning is more common than the company in articles.
  "nasdaq inc": "Nasdaq",
  crdo: "Credo Technology",
  credo: "Credo Technology",
  "credo technology": "Credo Technology",
  "credo technology group": "Credo Technology",
  cls: "Celestica",
  celestica: "Celestica",
  "celestica inc": "Celestica",
  // Planet Labs ticker PL intentionally NOT added — too short, high false-positive risk
  "planet labs": "Planet Labs",
  "planet labs pbc": "Planet Labs",
  suig: "SUI Group",
  "sui group": "SUI Group",
  "sui group holdings": "SUI Group",
  // Other watchlist tickers not yet covered above — major well-known names with
  // common variants. Tickers are added only when distinctive enough to avoid
  // collisions with common English words.
  tsla: "Tesla",
  tesla: "Tesla",
  "tesla inc": "Tesla",
  "tesla motors": "Tesla",
  intc: "Intel",
  intel: "Intel",
  "intel corporation": "Intel",
  "intel corp": "Intel",
  orcl: "Oracle",
  oracle: "Oracle",
  "oracle corporation": "Oracle",
  "oracle corp": "Oracle",
  visa: "Visa",
  "visa inc": "Visa",
  bx: "Blackstone",
  blackstone: "Blackstone",
  "blackstone inc": "Blackstone",
  "blackstone group": "Blackstone",
  tsm: "Taiwan Semiconductor",
  "taiwan semiconductor": "Taiwan Semiconductor",
  "taiwan semiconductor manufacturing": "Taiwan Semiconductor",
  tsmc: "Taiwan Semiconductor",
  spgi: "S&P Global",
  "s&p global": "S&P Global",
  "s&p global inc": "S&P Global",
  glw: "Corning",
  corning: "Corning",
  "corning inc": "Corning",
  "corning incorporated": "Corning",
  fcx: "Freeport-McMoRan",
  "freeport-mcmoran": "Freeport-McMoRan",
  "freeport mcmoran": "Freeport-McMoRan",
};

// ---------------------------------------------------------------------------
// Legal suffix stripper
// ---------------------------------------------------------------------------
// Stripped from the end before a second CANONICAL lookup. Requires a comma or
// whitespace before the suffix to avoid false matches on brand words.
// Two alternations:
//   1. Optional [Markets|Holdings|Group|International] followed by a legal entity
//      suffix (Inc, Corp, etc.). Strips e.g. "Robinhood Markets Inc" → "Robinhood",
//      "CrowdStrike Holdings Inc" → "CrowdStrike", and standalone "Apple Inc".
//   2. Trailing [Markets|Holdings|Group|International] without a legal suffix.
//      Strips "CrowdStrike Holdings" → "CrowdStrike", "Goldman Sachs Group" →
//      "Goldman Sachs".

export const LEGAL_SUFFIX_RE =
  /(?:[,\s]+(?:markets|holdings|group|international))?[,\s]+(?:inc\.?|corp\.?|corporation|llc|ltd\.?|limited|plc|l\.p\.?|llp|s\.a\.?|n\.v\.?|ag|gmbh)$|[,\s]+(?:markets|holdings|group|international)$/i;

// ---------------------------------------------------------------------------
// Company identity map (~30 curated companies)
// ---------------------------------------------------------------------------
// `industry` labels the content type in memo inputs.
// `brief` is injected verbatim into the Company Brief section — no model generation.
// Unmapped companies get no Company Brief section.

export const COMPANY_IDENTITY: Record<string, CompanyIdentity> = {
  // Semiconductors & Hardware
  "NVIDIA":             { industry: "Semiconductors",          brief: "NVIDIA designs GPUs and accelerated computing platforms used in AI training, data center infrastructure, gaming, and professional visualization." },
  "Intel":              { industry: "Semiconductors",          brief: "Intel designs and manufactures CPUs, GPUs, and networking chips for computing, data center, and AI workloads." },
  "Marvell Technology": { industry: "Semiconductors",          brief: "Marvell Technology designs custom ASICs and networking semiconductors for data centers, 5G carriers, and enterprise storage, with a strategic focus on AI networking and cloud infrastructure acceleration." },
  // Consumer & Enterprise Technology
  "Apple":              { industry: "Consumer Technology",     brief: "Apple designs consumer electronics, software, and services — including iPhone, Mac, and iPad — anchored by its tightly integrated hardware-software ecosystem." },
  "Microsoft":          { industry: "Technology",              brief: "Microsoft develops operating systems, enterprise software, and cloud infrastructure (Azure), serving enterprise and consumer markets globally." },
  "Alphabet":           { industry: "Technology",              brief: "Alphabet operates Google Search, YouTube, and Google Cloud; it generates revenue primarily from digital advertising and cloud services." },
  "Meta":               { industry: "Technology",              brief: "Meta operates Facebook, Instagram, and WhatsApp, generating revenue primarily from digital advertising across its family of social apps." },
  "Amazon":             { industry: "Technology / E-Commerce", brief: "Amazon operates the world's largest e-commerce marketplace and cloud infrastructure platform (AWS), with additional businesses in logistics, advertising, and streaming." },
  "Tesla":              { industry: "Electric Vehicles",       brief: "Tesla designs and manufactures electric vehicles, energy storage systems, and solar products, and develops autonomous driving software." },
  "Salesforce":         { industry: "Enterprise Software",     brief: "Salesforce provides cloud-based CRM software and enterprise applications for sales, service, marketing, and commerce teams." },
  "Oracle":             { industry: "Enterprise Technology",   brief: "Oracle provides enterprise database software, cloud infrastructure, and ERP applications primarily to large enterprises and governments." },
  "Palantir":           { industry: "Data Analytics",          brief: "Palantir develops AI-powered data analytics platforms for government intelligence agencies and large enterprises." },
  "IBM":                { industry: "Technology",              brief: "IBM provides hybrid cloud infrastructure, AI software, and IT services primarily to large enterprises and government customers." },
  // Artificial Intelligence
  "OpenAI":             { industry: "Artificial Intelligence", brief: "OpenAI develops large language models and AI systems — including GPT-4 and ChatGPT — offered via API and consumer products." },
  "Anthropic":          { industry: "Artificial Intelligence", brief: "Anthropic develops AI safety-focused large language models and AI systems, including the Claude family of models." },
  // Aerospace & Defense
  "Lockheed Martin":    { industry: "Aerospace & Defense",     brief: "Lockheed Martin is an aerospace and defense contractor that develops military aircraft, missile systems, space systems, and defense electronics for the U.S. military and allied governments." },
  "Boeing":             { industry: "Aerospace & Defense",     brief: "Boeing manufactures commercial jetliners, military aircraft, and space systems, and provides defense and aerospace services to government and commercial customers." },
  "Raytheon":           { industry: "Aerospace & Defense",     brief: "Raytheon develops missile systems, radar, sensors, and defense electronics for the U.S. military and allied governments." },
  "Northrop Grumman":   { industry: "Aerospace & Defense",     brief: "Northrop Grumman develops stealth aircraft, space systems, missile defense, and cybersecurity solutions for U.S. and allied defense programs." },
  "SpaceX":             { industry: "Aerospace",               brief: "SpaceX develops reusable rockets and spacecraft for satellite deployment, cargo resupply, and crewed missions to the International Space Station." },
  "General Dynamics":   { industry: "Aerospace & Defense",     brief: "General Dynamics manufactures military vehicles, submarines, combat systems, and provides IT services to government customers." },
  // Financial Services
  "JPMorgan Chase":     { industry: "Financial Services",      brief: "JPMorgan Chase is the largest U.S. bank by assets, providing investment banking, commercial banking, financial services, and asset management." },
  "Goldman Sachs":      { industry: "Investment Banking",      brief: "Goldman Sachs provides investment banking, securities trading, asset management, and financial advisory services to institutional and corporate clients globally." },
  "Morgan Stanley":     { industry: "Investment Banking",      brief: "Morgan Stanley provides investment banking, institutional securities, and wealth management services to governments, corporations, and high-net-worth clients." },
  "Bank of America":    { industry: "Financial Services",      brief: "Bank of America provides consumer banking, global markets, investment banking, and wealth management services across the U.S. and internationally." },
  "Berkshire Hathaway": { industry: "Diversified Financials",  brief: "Berkshire Hathaway is a diversified holding company with wholly owned businesses across insurance, railroads, utilities, manufacturing, and financial services." },
  "BlackRock":          { industry: "Asset Management",        brief: "BlackRock is the world's largest asset manager, providing investment management, risk advisory, and financial technology services to institutional and retail investors." },
  "Visa":               { industry: "Financial Technology",    brief: "Visa operates a global digital payments network connecting consumers, merchants, and financial institutions across more than 200 countries." },
  "Mastercard":         { industry: "Financial Technology",    brief: "Mastercard operates a global payment processing network and provides digital commerce technology to banks, merchants, and governments." },
  // Healthcare & Pharma
  "Pfizer":             { industry: "Pharmaceuticals",         brief: "Pfizer discovers, develops, and manufactures pharmaceutical drugs and vaccines across oncology, immunology, cardiology, and infectious disease." },
  "Johnson & Johnson":  { industry: "Healthcare",              brief: "Johnson & Johnson develops pharmaceuticals, medical devices, and consumer health products across a broad range of therapeutic areas." },
  // Energy & Consumer
  "ExxonMobil":         { industry: "Energy",                  brief: "ExxonMobil explores for, produces, refines, and markets petroleum products, natural gas, and petrochemicals globally." },
  "Chevron":            { industry: "Energy",                  brief: "Chevron explores for, produces, and refines petroleum and natural gas, and is expanding into lower-carbon energy businesses." },
  "Walmart":            { industry: "Consumer Retail",         brief: "Walmart operates the world's largest retail network of physical stores and e-commerce, targeting everyday low prices for mass-market consumers." },
};

// ---------------------------------------------------------------------------
// Junk-name filters (defense-in-depth against extraction artifacts)
// ---------------------------------------------------------------------------

export const JUNK_WORDS = new Set([
  "companies", "company", "firms", "firm", "startups", "startup",
  "enterprises", "conglomerates", "banks", "insurers", "retailers",
  "manufacturers", "providers", "operators", "investors", "funds",
  "giants", "players", "leaders", "vendors", "competitors",
  // Common generic words that are never standalone company names
  "news", "army", "navy", "military", "windows", "linux", "also",
  "sterling", "united", "senior",
]);

// Compound category labels that neither word alone would catch.
export const JUNK_PHRASES = new Set([
  "big tech", "big oil", "big pharma",
  "wall street",
]);

// Exact-match sets — currencies and countries should never appear as company names
const CURRENCY_BLOCKLIST = new Set([
  "bitcoin", "ethereum", "usd", "btc", "eth", "usdc", "usdt", "crypto",
  "tether", "ripple", "solana", "dogecoin", "litecoin", "binance coin",
  "binance", "eur", "gbp", "yuan", "yen", "cny", "jpy", "euro",
]);

const COUNTRY_BLOCKLIST = new Set([
  "iran", "china", "russia", "usa", "united states", "united states of america",
  "uk", "united kingdom", "israel", "north korea", "south korea", "germany",
  "france", "japan", "india", "brazil", "australia", "canada", "mexico",
  "turkey", "saudi arabia", "ukraine", "taiwan", "pakistan", "egypt",
  "indonesia", "nigeria", "south africa", "argentina",
]);

// Substring-match patterns for government bodies and law firms
const GOV_SUBSTRINGS = [
  "department of", "ministry of", "federal reserve", "sec ", "the sec",
  " fda", "congress", "senate", "white house", "pentagon", " nato",
  "european union", "world bank", " imf", " cia", " fbi", " doj",
  "department of justice", "department of defense", "u.s. army",
  "u.s. navy", "u.s. air force", "treasury department",
  "internal revenue", "federal bureau",
  "securities and exchange commission", "federal trade commission",
  "federal deposit insurance", "consumer financial protection",
  "international monetary fund", "european commission",
  "european central bank", "bank of england", "bank of japan",
  "bank of canada", "reserve bank of",
  // Military branches and additional government bodies
  "space force", "air force", "us navy", "postal service",
  "open market committee", "comptroller of the currency",
  "defense intelligence", "homeland security",
];

const LAW_SUBSTRINGS = [
  "law offices of", "law office of", "llp", " & associates",
  "attorneys at law", "legal group", "law group", "p.c.", "pllc",
  "law firm", "legal counsel",
];

// Stock market indexes — exact match
const INDEX_BLOCKLIST = new Set([
  "nifty 50", "nifty", "sensex", "s&p", "nasdaq", "dow jones", "ftse",
  "hang seng", "dax", "cac 40", "nikkei", "asx",
]);

// Named individuals — exact match on lowercased full name
const PEOPLE_BLOCKLIST = new Set([
  "xi jinping", "elon musk", "tulsi gabbard", "roger stone", "trump",
  "michael burry", "trump administration", "starmer", "janet mills",
  "graham platner", "viktor orban",
]);

// Known junk entities that slip past pattern matching — exact match catch-all
const KNOWN_JUNK_ENTITIES = new Set([
  "howard g. smith", "ims legal strategies", "klb business valuations",
]);

// Abstract noun phrases — substring match on lowercased name
const ABSTRACT_SUBSTRINGS = [
  "drone makers", "energy sector", "kuomintang", "communist party",
  "heritage foundation", "stocks", "stock",
];

export function isJunkEntityName(raw: string): boolean {
  if (raw.includes("(") || raw.includes(")")) return true;
  if (/\be\.g\./i.test(raw)) return true;
  if (raw.length > 60) return true;
  const lower = raw.toLowerCase().trim();
  if (JUNK_PHRASES.has(lower)) return true;
  const words = lower.split(/[\s,/&]+/).filter(Boolean);
  if (words.some((w) => JUNK_WORDS.has(w))) return true;
  // Currencies and countries — exact match
  if (CURRENCY_BLOCKLIST.has(lower)) return true;
  if (COUNTRY_BLOCKLIST.has(lower)) return true;
  // Government bodies and law firms — substring match
  if (GOV_SUBSTRINGS.some((pat) => lower.includes(pat))) return true;
  if (LAW_SUBSTRINGS.some((pat) => lower.includes(pat))) return true;
  // Stock indexes, named individuals, abstract phrases, and known junk entities
  if (INDEX_BLOCKLIST.has(lower)) return true;
  if (PEOPLE_BLOCKLIST.has(lower)) return true;
  if (KNOWN_JUNK_ENTITIES.has(lower)) return true;
  if (ABSTRACT_SUBSTRINGS.some((pat) => lower.includes(pat))) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Core name utilities
// ---------------------------------------------------------------------------

export function canonicalize(name: string): string {
  const trimmed = name.trim().replace(/[.,]$/g, "");
  const key = trimmed.toLowerCase();

  if (CANONICAL[key]) return CANONICAL[key];

  const stripped = trimmed.replace(LEGAL_SUFFIX_RE, "").trim();
  if (stripped.length >= 4 && stripped !== trimmed) {
    const strippedKey = stripped.toLowerCase();
    if (CANONICAL[strippedKey]) return CANONICAL[strippedKey];
    return stripped;
  }

  return trimmed;
}

// ---------------------------------------------------------------------------
// WD136 Phase 1: read-side variant expansion
// ---------------------------------------------------------------------------
// Source of truth: .claude/recon/agent-wd136-scope.md
//
// Why this exists:
//   articles.companies is a Postgres text[] array. Filtering with
//   `.contains("companies", [canonicalName])` is case-sensitive and matches
//   only one surface form. The CANONICAL map already enumerates the known
//   surface forms (lowercase keys) that map to each canonical name, but it
//   was previously only used to compute the canonical name itself, never to
//   expand the filter into the surface-form set actually present in the data.
//
//   For NVIDIA, that single-name filter returns 10 rows when the union of all
//   surface forms returns ~448 (97.8% blackout). Same pattern for Alphabet
//   (133 vs 315), JPMorgan Chase (12 vs 55), Anthropic, Apple, Meta, etc.
//
// What this provides:
//   - getCompanyVariants(canonical): all surface forms that should be matched
//     for a given canonical name. Derived by inverting CANONICAL: every key
//     whose value equals `canonical` becomes a candidate variant. We then
//     emit a small, deterministic set of casing forms per variant (Title Case
//     of the lowercase key, plus the canonical itself), de-duped.
//   - buildCompanyContainsOr(variants): a PostgREST `.or(...)` expression
//     string that ORs together one `companies.cs.{variant}` per variant.
//     Each variant is escaped for the PostgREST array-literal syntax.
//
// What this does NOT do:
//   - No new alias data. Only existing CANONICAL entries are consulted.
//   - No write-side changes. `articles.companies` is never modified.
//   - No SQL functions, no migrations.
//   - Long-tail variants outside CANONICAL (e.g. "Nvidia Inc.") remain
//     stranded; that is Phase 2 (write-side canonicalize + backfill in the
//     supervised entity-cleanup window).

/**
 * Return all surface-form variants that should be matched when filtering
 * `articles.companies` for a given canonical name. The canonical name itself
 * is always the first element. The remainder are derived from CANONICAL keys
 * that resolve to this canonical, with case variants common in stored rows.
 *
 * Deterministic, dedupe-preserving order so callers can rely on the first
 * element for logging / cache-key purposes.
 */
export function getCompanyVariants(canonical: string): string[] {
  const variants = new Set<string>();
  variants.add(canonical);

  // Also expand each whitespace-separated token of the canonical name into a
  // standalone variant when the token itself is a distinctive multi-letter
  // word. This catches abbreviated surface forms commonly written by ingest,
  // e.g. canonical "JPMorgan Chase" -> first-token variant "JPMorgan", which
  // is the way ~30 rows are stored even though CANONICAL keys are lowercased
  // and never reproduce that internal capital. Only the first token is
  // expanded (and only when length >= 5) to avoid expanding generic words
  // like "Inc", "Corp", "Group", "The", etc.
  const firstToken = canonical.split(/\s+/)[0];
  if (firstToken && firstToken.length >= 5 && firstToken !== canonical) {
    variants.add(firstToken);
  }

  // Lowercase keys in CANONICAL whose value matches `canonical` are alias
  // candidates. For each key, emit a few common casing forms seen in the
  // wild: as-typed lowercase, Title Case, and the original key with its
  // first letter uppercased.
  for (const [key, value] of Object.entries(CANONICAL)) {
    if (value !== canonical) continue;
    // Skip very short keys (tickers like "hood", "coin") - they create
    // false-positive matches against unrelated `companies` entries.
    if (key.length < 4) continue;
    // Original lowercase form (some ingest rows store lowercase).
    variants.add(key);
    // Title Case: capitalize first letter of each word.
    variants.add(
      key
        .split(/(\s+)/)
        .map((part) =>
          /\s+/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1),
        )
        .join(""),
    );
    // ALL-CAPS first word + Title Case rest (handles "NVIDIA Corporation").
    const words = key.split(/\s+/);
    if (words.length > 0 && words[0].length > 0) {
      const allCapsFirst = [
        words[0].toUpperCase(),
        ...words
          .slice(1)
          .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)),
      ].join(" ");
      variants.add(allCapsFirst);
    }
    // Special: punctuated suffix variants. "nvidia corp" should also try
    // "Nvidia Corp." and "NVIDIA Corp." since ingest sometimes preserves
    // the trailing period.
    if (/\b(corp|inc)$/i.test(key)) {
      variants.add(
        key
          .split(/(\s+)/)
          .map((part) =>
            /\s+/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1),
          )
          .join("") + ".",
      );
      const wordsForPeriod = key.split(/\s+/);
      if (wordsForPeriod.length > 0 && wordsForPeriod[0].length > 0) {
        variants.add(
          [
            wordsForPeriod[0].toUpperCase(),
            ...wordsForPeriod
              .slice(1)
              .map((w) =>
                w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w,
              ),
          ].join(" ") + ".",
        );
      }
    }
  }

  return Array.from(variants);
}

/**
 * Escape a single value for use inside a PostgREST array literal. PostgREST
 * `cs.{"...","..."}` syntax requires quoting any value containing commas,
 * spaces, periods, or special characters, with backslash-escaped embedded
 * double quotes.
 */
function escapeForPostgrestArrayLiteral(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Build a PostgREST `.or(...)` filter expression that matches `articles.companies`
 * against ANY of the supplied variants using array containment (`cs`).
 *
 * Usage:
 *   const variants = getCompanyVariants(canonicalName);
 *   query = query.or(buildCompanyContainsOr(variants));
 *
 * Returns a single-variant `companies.cs.{...}` (no comma) when there is only
 * one variant, so the result is always a valid PostgREST `or` argument.
 */
export function buildCompanyContainsOr(variants: string[]): string {
  if (variants.length === 0) return "";
  return variants
    .map(
      (v) => `companies.cs.{${escapeForPostgrestArrayLiteral(v)}}`,
    )
    .join(",");
}

export function parseCompanies(cos: unknown): string[] {
  if (!cos) return [];
  if (typeof cos === "string") {
    try { return JSON.parse(cos); } catch { return []; }
  }
  return Array.isArray(cos) ? (cos as string[]) : [];
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Article matching utilities
// ---------------------------------------------------------------------------

export function matchesCanonical(rawName: string, canonicalName: string): boolean {
  const rawCanon = canonicalize(rawName).toLowerCase();
  const targetLower = canonicalName.toLowerCase();
  if (rawCanon === targetLower) return true;
  if (targetLower.length >= 5 && rawCanon.startsWith(targetLower)) return true;
  if (rawCanon.length >= 5 && targetLower.startsWith(rawCanon)) return true;
  return false;
}

// Returns true if companyName is the grammatical subject of the headline.
// Used as a fallback actor signal for Funding/IPO where primary_company is null.
export function isSubjectOfTitle(title: string, companyName: string): boolean {
  const t = title.toLowerCase().trim();
  const cn = companyName.toLowerCase();
  const stripped = t
    .replace(/^(report|breaking|exclusive|sources?|scoop|update|analysis)[:\s]+["']?/, "")
    .trimStart();
  return (
    stripped.startsWith(cn + " ") ||
    stripped.startsWith(cn + "'") ||
    stripped.startsWith(cn + ",")
  );
}

// Returns true if the selected company is explicitly named anywhere in the article title.
export function titleNamesCompany(title: string, cosRaw: string[], name: string): boolean {
  const t = title.toLowerCase();
  const nameLower = name.toLowerCase();

  if (nameLower.length >= 5 && t.includes(nameLower)) return true;

  for (const raw of cosRaw) {
    const cCanon = canonicalize(raw).toLowerCase();
    const isOurCompany =
      cCanon === nameLower ||
      (nameLower.length >= 5 && cCanon.startsWith(nameLower)) ||
      (cCanon.length >= 5 && nameLower.startsWith(cCanon));
    if (!isOurCompany) continue;

    const rawNorm = raw.trim().replace(/[.,]$/g, "").toLowerCase();
    if (rawNorm.length >= 5 && t.includes(rawNorm)) return true;
    const firstWord = rawNorm.split(/\s+/)[0];
    if (firstWord.length >= 6 && t.includes(firstWord)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Development classification
// ---------------------------------------------------------------------------

export const DEVELOPMENT_DEAL_TYPES = new Set(["Earnings", "M&A", "Funding", "IPO"]);
export const TAGGED_DEAL_TYPES = new Set(["Earnings", "M&A", "Funding", "IPO", "Macro", "Geopolitical", "Other"]);

// ---------------------------------------------------------------------------
// Article processing
// ---------------------------------------------------------------------------

/**
 * WD130: per-article body cap (chars) used by `formatArticleList`.
 *
 * The memo route truncates the entire prompt content to 4000 chars
 * (src/app/api/memo/route.ts). With ~10 in-pool articles + ~250 chars of
 * memo header + ~110 chars per-article overhead (index/title/source/date),
 * a 600-char body cap lets a 10-article dev-led pool stay well within budget
 * in the typical case (most articles have <300 char summaries) while
 * delivering 3.3x more body text per article than the previous 180-char
 * slice in the long-content/long-summary cases that actually drove the
 * truncation problem.
 */
const ARTICLE_BODY_CAP = 600;

/**
 * WD130: pick the richer text source for an article and word-boundary
 * truncate it. Prefers `content` when present and meaningfully longer than
 * `summary`; otherwise returns the (un-sliced) summary. Always collapses
 * runs of whitespace to a single space so the prompt stays compact.
 *
 * Word-boundary truncation: if the text exceeds `cap`, scan back from `cap`
 * to the most recent space and cut there, append " ..." sentinel. This
 * avoids the prior behavior of cutting mid-word ("This sentence is unfini").
 * If no space is found within the first 80% of the cap, fall back to a hard
 * cut so we never return an empty body for pathological inputs.
 */
// Legacy first-cap excerpt: word-boundary truncate at `cap` and append a
// trailing sentinel. Kept verbatim from the pre-WD134 pickArticleBody so the
// non-facet path stays byte-identical.
function firstCapExcerpt(source: string, cap: number): string {
  const window = source.slice(0, cap);
  const lastSpace = window.lastIndexOf(" ");
  const cutAt = lastSpace >= Math.floor(cap * 0.8) ? lastSpace : cap;
  return source.slice(0, cutAt) + " ...";
}

// WD143: multi-facet excerpt window tuning. Single-window articles keep the
// 600-char cap unchanged; a multi-facet-spread article gets up to MAX_WINDOWS
// focused windows of PER_WINDOW_CAP each. GLOBAL_CAP is a hard ceiling on the
// final joined output (joiner and edge sentinels included), enforced by
// joinWindows: it bounds how many windows can be requested AND trims the
// trailing window at a word boundary if assembly overshoots, so the returned
// excerpt is always <= GLOBAL_CAP. MIN_CLUSTER_SCORE gates lone-keyword
// clusters out of their own window.
const PER_WINDOW_CAP = 400;
const GLOBAL_CAP = 800;
const MAX_WINDOWS = 2;
const MIN_CLUSTER_SCORE = 1;

interface CenteredWindow {
  text: string;
  start: number;
  end: number;
  startCut: boolean;
  endCut: boolean;
}

// Max-coverage centering scoped to `spans`, at width `cap`. This is the WD134
// single-window logic, extracted and parameterized on cap + span subset so the
// multi-window path can reuse it per cluster with a smaller cap. Returns the
// word-boundary-trimmed slice bounds, per-edge cut flags, and sentinel-wrapped
// text (the single-facet path returns `.text` verbatim, byte-identical to WD134).
function centeredWindow(source: string, spans: FacetSpan[], cap: number): CenteredWindow {
  const maxStart = source.length - cap;
  let best: { start: number; end: number; score: number; hasDigit: boolean } | null = null;

  for (const center of spans) {
    const mid = (center.start + center.end) / 2;
    let winStart = Math.round(mid - cap / 2);
    if (winStart < 0) winStart = 0;
    if (winStart > maxStart) winStart = maxStart;
    if (center.start < winStart) winStart = center.start;
    if (center.end > winStart + cap) winStart = Math.min(center.end - cap, maxStart);
    if (winStart < 0) winStart = 0;
    const winEnd = winStart + cap;

    let score = 0;
    for (const s of spans) {
      if (s.start >= winStart && s.end <= winEnd) score++;
    }

    const cand = { start: winStart, end: winEnd, score, hasDigit: center.hasDigit };
    if (best === null) {
      best = cand;
    } else if (cand.score !== best.score) {
      if (cand.score > best.score) best = cand;
    } else if (cand.hasDigit !== best.hasDigit) {
      // Equal coverage: quantified detail beats a bare keyword.
      if (cand.hasDigit) best = cand;
    } else if (cand.start < best.start) {
      // Equal coverage and equal digit-ness: prefer the earlier window.
      best = cand;
    }
  }

  const chosen = best!;
  const startCut = chosen.start > 0;
  const endCut = chosen.end < source.length;
  let s = chosen.start;
  let e = chosen.end;
  if (startCut) {
    const sp = source.indexOf(" ", s);
    if (sp !== -1 && sp < e) s = sp + 1;
  }
  if (endCut) {
    const sp = source.lastIndexOf(" ", e);
    if (sp > s) e = sp;
  }
  let text = source.slice(s, e).trim();
  if (startCut) text = "... " + text;
  if (endCut) text = text + " ...";
  return { text, start: s, end: e, startCut, endCut };
}

// Group spans (already sorted by start) into position clusters: a new cluster
// begins when a span starts more than `gap` chars after the previous span.
function clusterByPosition(spans: FacetSpan[], gap: number): FacetSpan[][] {
  const clusters: FacetSpan[][] = [];
  let prevStart = Number.NEGATIVE_INFINITY;
  for (const span of spans) {
    if (clusters.length === 0 || span.start - prevStart > gap) {
      clusters.push([span]);
    } else {
      clusters[clusters.length - 1].push(span);
    }
    prevStart = span.start;
  }
  return clusters;
}

// Pick up to `max` clusters, preferring distinct-facet coverage so a far-apart
// facet (e.g. governance) keeps its slot rather than losing it to a second
// same-facet cluster, tiebreaking by span count then earliest position.
function selectClusters(clusters: FacetSpan[][], max: number): FacetSpan[][] {
  if (clusters.length <= max) return clusters;
  const byScore = [...clusters].sort((a, b) => b.length - a.length || a[0].start - b[0].start);
  const picked: FacetSpan[][] = [];
  const covered = new Set<string>();
  for (const c of byScore) {
    if (picked.length >= max) break;
    if ([...new Set(c.map((s) => s.facet))].some((f) => !covered.has(f))) {
      picked.push(c);
      c.forEach((s) => covered.add(s.facet));
    }
  }
  for (const c of byScore) {
    if (picked.length >= max) break;
    if (!picked.includes(c)) picked.push(c);
  }
  return picked;
}

// Assemble windows into one excerpt. Overlapping or touching windows merge so
// text is never duplicated and no doubled sentinel is emitted; a single " ... "
// separates disjoint windows, with directional sentinels at the outer edges only.
// `cap` is a hard ceiling on the returned string (joiner + sentinels included):
// if assembly overshoots, the trailing window is trimmed back to a word boundary
// and the trailing sentinel re-attached so the truncation stays visible.
function joinWindows(source: string, windows: CenteredWindow[], cap: number): string {
  const intervals = windows.map((w) => ({ s: w.start, e: w.end })).sort((a, b) => a.s - b.s);
  const merged: Array<{ s: number; e: number }> = [];
  for (const cur of intervals) {
    const last = merged[merged.length - 1];
    if (last && cur.s <= last.e) last.e = Math.max(last.e, cur.e);
    else merged.push({ ...cur });
  }
  let body = merged.map((m) => source.slice(m.s, m.e).trim()).join(" ... ");
  if (merged[0].s > 0) body = "... " + body;
  if (merged[merged.length - 1].e < source.length) body = body + " ...";

  // GLOBAL_CAP is an output ceiling, not just a pre-join content budget: the
  // " ... " joiner and edge sentinels count against it. If the assembled body
  // overshoots, trim the trailing window at the most recent word boundary that
  // leaves room for the trailing sentinel (same idiom as firstCapExcerpt).
  if (body.length > cap) {
    const sentinel = " ...";
    const budget = cap - sentinel.length;
    const head = body.slice(0, budget);
    const lastSpace = head.lastIndexOf(" ");
    const cutAt = lastSpace >= Math.floor(budget * 0.8) ? lastSpace : budget;
    body = body.slice(0, cutAt).trimEnd() + sentinel;
  }
  return body;
}

function pickArticleBody(a: CompanyArticle, cap: number): string {
  const summary = (a.summary ?? "").replace(/\s+/g, " ").trim();
  const content = (a.content ?? "").replace(/\s+/g, " ").trim();

  // Prefer content only when it carries materially more text than the
  // summary. The threshold (summary length + 50 chars) avoids switching to
  // a near-identical content field that re-renders the same opening sentence
  // for a few extra trailing words.
  const source = content.length > summary.length + 50 ? content : summary;
  if (source.length === 0) return "";
  if (source.length <= cap) return source;

  // Non-facet articles keep the legacy first-cap excerpt unchanged.
  if (!isFacetProtected(a)) return firstCapExcerpt(source, cap);

  // WD134 + WD143 smart-excerpt: for facet-protected articles the analyst-critical
  // detail (e.g. an "85.1% voting power" governance figure) often sits deep in
  // the body while the lede carries only a bare keyword, and first-cap clips
  // exactly the figures the facet protection exists to preserve.
  const spans = facetMatchSpans(source);
  if (spans.length === 0) return firstCapExcerpt(source, cap); // guard: facet hit was in title/summary only

  // WD143: cluster facet spans by position. A single cluster (the common case,
  // including every single-facet article) keeps WD134's single-window behavior
  // unchanged. A genuinely multi-facet-spread article gets one focused window
  // per cluster so a non-densest facet (e.g. an 85.1% governance figure in a
  // loss-dominated filing) survives instead of being clipped.
  const clusters = clusterByPosition(spans, PER_WINDOW_CAP).filter(
    (c) => c.length >= MIN_CLUSTER_SCORE,
  );
  const distinctFacets = new Set(clusters.flatMap((c) => c.map((s) => s.facet)));
  if (clusters.length <= 1 || distinctFacets.size <= 1) {
    // Single window at the caller's cap (600). Byte-identical to WD134.
    return centeredWindow(source, spans, cap).text;
  }

  // Multi-facet-spread: one focused window per selected cluster, joined.
  const maxWindows = Math.min(MAX_WINDOWS, Math.max(1, Math.floor(GLOBAL_CAP / PER_WINDOW_CAP)));
  const windows = selectClusters(clusters, maxWindows)
    .map((c) => centeredWindow(source, c, PER_WINDOW_CAP))
    .sort((w1, w2) => w1.start - w2.start);
  return joinWindows(source, windows, GLOBAL_CAP);
}

/**
 * Format an article list for inclusion in a memo user message.
 *
 * When `startIndex` is provided, each article is prefixed with a 1-indexed
 * `[N]` marker (N = startIndex + position). The contiguous numbering across
 * devArts + ctxArts (devArts first, ctxArts starting at devArts.length + 1)
 * gives the model a stable citation key for `[n]` provenance markers in the
 * memo body. Callers therefore pass startIndex = 1 for devArts and
 * startIndex = devArts.length + 1 for ctxArts so the indices form a single
 * 1..N namespace across the two lists. When `startIndex` is omitted, the
 * legacy bullet form is emitted (kept for back-compat with non-citation
 * callers).
 *
 * WD130: the article body is now sourced via `pickArticleBody`, which prefers
 * full `content` when present and meaningfully longer than `summary`,
 * otherwise falls back to the full `summary` (no 180-char slice), and
 * word-boundary truncates at `ARTICLE_BODY_CAP` (600 chars) instead of
 * cutting mid-sentence at 180 chars. The 4000-char total cap in the memo
 * route remains the binding outer constraint and is unchanged.
 */
export function formatArticleList(arts: CompanyArticle[], startIndex?: number): string {
  if (arts.length === 0) return "None";
  const sliced = arts.slice(0, 8); // safety cap; callers should pre-slice to their desired limit
  if (typeof startIndex === "number") {
    return sliced
      .map((a, i) => {
        const n = startIndex + i;
        const tag = a.deal_type && TAGGED_DEAL_TYPES.has(a.deal_type) ? `[${a.deal_type}] ` : "";
        const source = a.source ? ` (${a.source})` : "";
        const date = a.published_at ? ` | ${a.published_at.slice(0, 10)}` : "";
        const body = pickArticleBody(a, ARTICLE_BODY_CAP);
        const bodyOut = body ? ` :: ${body}` : "";
        return `[${n}] ${tag}${a.title}${source}${date}${bodyOut}`;
      })
      .join("\n");
  }
  return sliced
    .map((a) => {
      const tag = a.deal_type && TAGGED_DEAL_TYPES.has(a.deal_type) ? `[${a.deal_type}] ` : "";
      const body = pickArticleBody(a, ARTICLE_BODY_CAP);
      const bodyOut = body ? ` -- ${body}` : "";
      return `* ${tag}${a.title}${bodyOut}`;
    })
    .join("\n\n");
}

/**
 * Filter a raw article list to those mentioning `companyName`, then classify
 * each as a development or context article. Identical logic to the list page's
 * loadArticles useEffect, extracted here so both routes share one implementation.
 */
export function filterAndClassifyArticles(
  articles: RawArticleRow[],
  companyName: string,
): CompanyArticle[] {
  const nameLower = companyName.toLowerCase();

  const matched = articles.filter((a) => {
    const cos = parseCompanies(a.companies);
    return cos.some((c) => {
      const cCanon = canonicalize(c).toLowerCase();
      if (cCanon === nameLower) return true;
      if (nameLower.length >= 5 && cCanon.startsWith(nameLower)) return true;
      if (cCanon.length >= 5 && nameLower.startsWith(cCanon)) return true;
      return false;
    });
  });

  return matched.map((a) => {
    const cosRaw = parseCompanies(a.companies);

    // WD127: Earnings/M&A with null primary_company are common in Yahoo
    // aggregator headlines that are still directly about the subject company
    // (e.g. "NVDA Reports Q3 Beat..."). Without the null-primary fallback they
    // mis-bucket as context, which (a) suppresses real direct-event coverage
    // and (b) trips the context-led Coverage Note banner ("No direct company
    // development articles") even when the pool contains a subject-of-title
    // earnings recap. The fallback uses isSubjectOfTitle, which requires the
    // company to be the first token of the headline (after stripping
    // REPORT:/BREAKING:-style prefixes) — sector-context articles where the
    // company merely appears mid-headline ("Microsoft challenges Apple's lead
    // in cloud") return false and do not mis-trigger as development. Direct
    // mirror of the existing isFundingOrIPO branch below.
    const isStrictDevelopment =
      (a.deal_type === "Earnings" || a.deal_type === "M&A") &&
      (
        (a.primary_company != null && matchesCanonical(a.primary_company, companyName)) ||
        (a.primary_company == null && isSubjectOfTitle(a.title, companyName))
      );

    const isFundingOrIPO =
      (a.deal_type === "Funding" || a.deal_type === "IPO") &&
      (
        (a.primary_company != null && matchesCanonical(a.primary_company, companyName)) ||
        (a.primary_company == null && isSubjectOfTitle(a.title, companyName))
      );

    const isMaterialCounterparty =
      !isStrictDevelopment &&
      !isFundingOrIPO &&
      // M&A only: catches acquisition targets that appear in object position when
      // primary_company is null ("Nvidia invests in Marvell" → Marvell as counterparty).
      // Funding/IPO are excluded because titleNamesCompany cannot distinguish an
      // investment target from a competitor reference or technology mention — those
      // cases (fundee with null primary_company) are handled by isFundingOrIPO via
      // isSubjectOfTitle. Keeping Funding/IPO here causes false positives whenever a
      // company is named as a challenge target, chip supplier, or comparison benchmark.
      a.deal_type === "M&A" &&
      a.primary_company == null &&
      titleNamesCompany(a.title, cosRaw, companyName) &&
      // Exclude subject-position companies: in M&A articles with null primary_company,
      // the grammatical subject is systematically an advisor/underwriter, not a target.
      !isSubjectOfTitle(a.title, companyName);

    return {
      id: a.id,
      title: a.title,
      source: a.source ?? undefined,
      sector: a.sector ?? undefined,
      sentiment: a.sentiment ?? undefined,
      summary: stripHtml(a.summary ?? undefined),
      // WD130: pass `content` through so formatArticleList can prefer it over
      // `summary` when it carries more of the article body. `stripHtml` returns
      // "" for null/undefined input, so a null-check guard preserves "no
      // content" vs "empty after strip".
      content: a.content != null ? stripHtml(a.content) : null,
      published_at: a.published_at ?? a.ingested_at ?? undefined,
      url: a.url ?? undefined,
      primary_company: a.primary_company ?? null,
      relevance_score: typeof a.relevance_score === "number" ? a.relevance_score : undefined,
      deal_type: typeof a.deal_type === "string" ? a.deal_type : null,
      _isDevelopment: isStrictDevelopment || isFundingOrIPO || isMaterialCounterparty,
    };
  });
}

// ---------------------------------------------------------------------------
// Memo content builders
// ---------------------------------------------------------------------------

// Rank development articles by relevance (recency tiebreak) and cap the list.
// WD141: facet-protected articles (WD129's governance/bear/financial-risk/
// valuation picks) are partitioned out first so they survive the cap. Without
// this, a protected article tying on relevance loses the recency tiebreak and
// gets sliced past the cap before the model sees it, silently defeating WD129.
// The cap lives here (single source of truth) so callers do not re-slice.
function byRelevance(arts: CompanyArticle[], cap = 6): CompanyArticle[] {
  const sorted = [...arts].sort((a, b) => {
    const scoreDiff = (b.relevance_score ?? 5) - (a.relevance_score ?? 5);
    if (scoreDiff !== 0) return scoreDiff;
    const dateA = a.published_at ? new Date(a.published_at).getTime() : 0;
    const dateB = b.published_at ? new Date(b.published_at).getTime() : 0;
    return dateB - dateA;
  });
  const protectedArts = sorted.filter((a) => isFacetProtected(a));
  const unprotected = sorted.filter((a) => !isFacetProtected(a));
  return [...protectedArts, ...unprotected].slice(0, cap);
}

// Company-specific relevance score for context article ranking.
// Distinct from `relevance_score` (Groq's general financial-market signal).
// Gives +3 for full company name in title, +2 for first significant word (handles
// "Goldman" matching "Goldman Sachs"), +2 for development deal types, +1 for high
// general relevance. Max possible score is 6.
function contextScore(a: CompanyArticle, companyName: string): number {
  let score = 0;
  const titleLower = a.title.toLowerCase();
  const nameLower = companyName.toLowerCase();

  if (titleLower.includes(nameLower)) {
    score += 3; // full canonical name in title
  } else {
    const firstWord = nameLower.split(/\s+/)[0];
    if (firstWord.length >= 5 && titleLower.includes(firstWord)) {
      score += 2; // significant first word (e.g. "Goldman" for "Goldman Sachs")
    }
  }

  if (a.deal_type != null && DEVELOPMENT_DEAL_TYPES.has(a.deal_type)) score += 2;
  if ((a.relevance_score ?? 0) >= 8) score += 1;

  return score;
}

// Rank context articles by company-specific signal, then filter noise.
// Returns at most 4 articles — fewer, higher-quality articles produce sharper
// memo synthesis than a longer list of mixed-signal items.
function selectContextArticles(arts: CompanyArticle[], companyName: string): CompanyArticle[] {
  const cap = 4;

  // WD141: facet-protected context articles (WD129 picks) bypass the
  // contextScore ranking AND the zero-signal noise filter below. A governance
  // or bear article without the company name in its title scores 0 on
  // contextScore and would otherwise be dropped, defeating WD129's protection.
  const protectedArts = arts.filter((a) => isFacetProtected(a));
  const unprotected = arts.filter((a) => !isFacetProtected(a));

  const ranked = [...unprotected].sort((a, b) => {
    const csDiff = contextScore(b, companyName) - contextScore(a, companyName);
    if (csDiff !== 0) return csDiff;
    // Tiebreak: general relevance, then recency
    const relDiff = (b.relevance_score ?? 5) - (a.relevance_score ?? 5);
    if (relDiff !== 0) return relDiff;
    return (b.published_at ? new Date(b.published_at).getTime() : 0)
         - (a.published_at ? new Date(a.published_at).getTime() : 0);
  });

  // If at least 4 articles have company-specific signal (score > 0), drop
  // zero-signal articles so the model isn't diluted by incidental mentions.
  // Conservative: only filter when ≥4 signal articles remain without them.
  // Applied to the unprotected pool only — protected articles are kept.
  const withSignal = ranked.filter((a) => contextScore(a, companyName) > 0);
  const unprotectedPool = withSignal.length >= 4 ? withSignal : ranked;

  return [...protectedArts, ...unprotectedPool].slice(0, cap);
}

// Build a descriptive signal quality label that tells the model what the evidence
// actually covers — richer than the former three-way "Strong/Limited/Mostly sector".
function buildSignalLabel(
  effectiveDevArts: CompanyArticle[],
  effectiveCtxArts: CompanyArticle[],
  companyName: string,
): string {
  if (effectiveDevArts.length === 0) {
    const nameLower = companyName.toLowerCase();
    const firstWord = nameLower.split(/\s+/)[0];
    const titleNamed = effectiveCtxArts.filter((a) => {
      const t = a.title.toLowerCase();
      return t.includes(nameLower) || (firstWord.length >= 5 && t.includes(firstWord));
    }).length;
    if (effectiveCtxArts.length === 0) return `No articles found for ${companyName} in current window`;
    const plural = effectiveCtxArts.length === 1 ? "article" : "articles";
    if (titleNamed >= 1) {
      return `No direct events - ${effectiveCtxArts.length} context ${plural}, ${titleNamed} with ${companyName} in title`;
    }
    return `No direct events - ${effectiveCtxArts.length} context ${plural}, ${companyName} mentioned incidentally`;
  }

  const types = [
    ...new Set(effectiveDevArts.map((a) => a.deal_type).filter((dt): dt is string => dt != null)),
  ];
  const typeStr = types.length > 0 ? ` (${types.join(", ")})` : "";
  const plural = effectiveDevArts.length === 1 ? "event" : "events";
  if (effectiveDevArts.length >= 2) return `${effectiveDevArts.length} direct company ${plural}${typeStr}`;
  return `1 direct company ${plural}${typeStr} - limited direct evidence`;
}

export function buildMemoContent(
  companyName: string,
  developmentArticles: CompanyArticle[],
  contextArticles: CompanyArticle[],
): string {
  const industry = COMPANY_IDENTITY[companyName]?.industry ?? "Unknown";

  // A single M&A development article is insufficient to enter developments-led mode.
  // M&A articles with null primary_company can still contain advisory/intermediary mentions
  // that passed the classification filter. Require either:
  //   (a) at least one Earnings, Funding, or IPO development (direct company events), or
  //   (b) two or more development articles of any type (signal confirmed by volume)
  // This prevents a lone M&A mention from producing an overstated "Recent Developments" section.
  const memoMode = (
    developmentArticles.some((a) => a.deal_type !== "M&A") ||
    developmentArticles.length >= 2
  ) ? "developments-led" : "context-led";

  // When context-led, fold any borderline development articles into the context pool.
  // This keeps the COMPANY DEVELOPMENT ARTICLES count at 0, making the "No direct
  // company developments found" coverage note accurate, while still surfacing those
  // articles to the model under SECTOR CONTEXT ARTICLES.
  const effectiveDevArts = memoMode === "developments-led" ? developmentArticles : [];
  const rawCtxArts =
    memoMode === "developments-led"
      ? contextArticles
      : [...developmentArticles, ...contextArticles];

  // Rank context articles by company-specific relevance and cap at 4.
  // Fewer, higher-signal articles produce sharper synthesis than a longer diluted list.
  const effectiveCtxArts = selectContextArticles(rawCtxArts, companyName);

  const signalLabel = buildSignalLabel(effectiveDevArts, effectiveCtxArts, companyName);

  return [
    `COMPANY: ${companyName}`,
    `COMPANY INDUSTRY: ${industry}`,
    `MEMO_MODE: ${memoMode}`,
    `SIGNAL QUALITY: ${signalLabel}`,
    ``,
    `COMPANY DEVELOPMENT ARTICLES (${effectiveDevArts.length}):`,
    formatArticleList(byRelevance(effectiveDevArts)),
    ``,
    `SECTOR CONTEXT ARTICLES (${effectiveCtxArts.length}):`,
    formatArticleList(effectiveCtxArts), // already ranked by selectContextArticles
  ].join("\n");
}

export function buildMemoSystemPrompt(companyName: string): string {
  const identity = COMPANY_IDENTITY[companyName];
  const backgroundBlock = identity
    ? `ANALYST BACKGROUND (use as grounding context only — do not output this block verbatim):
Industry: ${identity.industry}
Profile: ${identity.brief}

`
    : "";
  // Figure-rendering rules live in two places that must stay consistent: the
  // section-scoped "Do not round, approximate, or infer figures" clause in What
  // Just Changed (Sentence 1) and the global FINANCIAL-PRECISION RULE block
  // (WD132) below, after COVERAGE-BALANCE. The block is the authority; if either
  // is edited, reconcile both so they do not drift.
  return `You are a senior equity research analyst at a top-tier investment bank (Goldman Sachs, Morgan Stanley, JPMorgan level). You are writing a company intelligence brief that a junior analyst will hand to their Managing Director before a client call. The MD has 60 seconds to read it. They already know the company exists. They do not need a description of what it does. They need to know: what changed, what it means, and what to do about it.

Your output will be read by finance students, junior analysts, and early-career professionals developing genuine market intuition. Every sentence must teach them something they could not have gotten from reading the headline themselves.

SOURCING DISCIPLINE (apply to both modes, no exceptions):
Every specific figure, statistic, named event, percentage, dollar amount, and precise claim in the memo must be directly traceable to the provided article pool. Do not supplement with training knowledge. Do not add figures, valuations, growth rates, timelines, or named events that do not appear explicitly in the provided articles. If a figure or claim is not present in the provided articles, omit it entirely. Implications and analytical framing drawn from provided facts are permitted — invented figures are not. A memo with fewer specific claims that are all sourced is better than a memo with more claims that blend article content with model knowledge. When in doubt, omit. Before including any specific figure (percentage, dollar amount, ratio, multiplier), internally verify: does this exact figure appear in the article text provided? If you cannot point to the specific sentence in the provided articles where this figure appears, omit it. Do not include figures that are plausible, directionally correct, or consistent with your training knowledge. Only figures explicitly present in the provided article pool are permitted. If a company, statistic, or claim does not appear in the provided article titles or summaries, it does not exist for the purposes of this memo. Do not include any company, startup, competitor, or named entity that is not explicitly mentioned in the provided articles. This applies even if the entity is directionally relevant or commonly associated with the topic. A Korean startup, an unnamed competitor, or any entity not present in the article pool by name must be omitted entirely.

INPUTS: MEMO_MODE | SIGNAL QUALITY | COMPANY DEVELOPMENT ARTICLES | SECTOR CONTEXT ARTICLES

${backgroundBlock}─── UNIVERSAL OPENING RULES -- APPLY TO ALL SECTIONS, BOTH MODES, NO EXCEPTIONS ───

These rules outrank any section-specific instruction below (including the What Just Changed "Sentence 1: State the fact precisely" directive). If a section-specific instruction appears to conflict with a rule here, the rule here wins. Apply these rules to the opening sentence of EVERY section: Analyst Brief, What Just Changed (section 02), Cross-Signals (section 03), and What To Do With This (section 04).

1. No-company-name-as-grammatical-subject (applies to ALL sections, including section 02 What Just Changed): Never open any section with ${companyName} as the grammatical subject of the first sentence. This explicitly includes constructions like "${companyName} has filed...", "${companyName} reported...", "${companyName} announced...", "${companyName} is launching...". Instead, lead with the named counterparty, named filing, named regulator, named product, or specific dollar/percentage figure, and place ${companyName} as the object or in a subordinate clause. Acceptable rewrites: "The filing covers...", "Filings show...", "Pre-IPO disclosures landed with the SEC on...", "The SEC accepted ${companyName}'s pre-IPO disclosure on...", "A Starship test flight is scheduled for...". The fact is still stated precisely; only the grammatical subject changes.

2. No-"The"-or-mood-noun opener (applies to the Analyst Brief): Never open the Analyst Brief with "The" OR any abstract-mood-noun (e.g. Anticipation, Excitement, Concern, Optimism, Pessimism, Confidence, Uncertainty, Hope, Fear, Worry, Sentiment, Momentum). These openers signal opinion or framing rather than a sourced fact and degrade analyst-grade trust. If the first word would be one of those, rewrite to lead with the named event, named counterparty, named filing, or specific numeric figure that caused the mood. Example fix: instead of "Anticipation for a potential $2T IPO...", write "Pre-IPO disclosures from ${companyName} landed at the SEC on..." or "A $2T-plus IPO valuation range is now in prediction-market trading..." -- the figure or named filing leads, not the mood it produced.

─── COVERAGE-BALANCE RULE -- APPLIES TO ALL SECTIONS, BOTH MODES, CONDITIONAL ON THE POOL ───

This rule is SUBORDINATE TO SOURCING DISCIPLINE (the SOURCING DISCIPLINE block at the top of this prompt always wins). It outranks any section-specific filtering instruction below: if an article in the pool carries the material listed under TRIGGERS, the section-specific "what to cover" filters do not get to silently skip it.

TRIGGERS -- material that activates this rule when explicitly present in the COMPANY DEVELOPMENT ARTICLES or SECTOR CONTEXT ARTICLES pool:
- GOVERNANCE / CONTROL: dual-class shares, supervoting, voting power or voting control percentages, founder voting rights, board composition or proxy contests, "tight grip" or "management-favorable" framing tied to a named structure.
- STRUCTURAL FINANCIAL RISK: going concern, bridge loan, dilution risk, runway, cash burn, debt covenant, down round, "$X billion loss" framings tied to capital-structure consequence.
- BEAR / DISSENT: bearish sentiment articles, named short-seller commentary, ratings downgrades, "overvalued" or "hard to justify" or "frothy" or "skeptical" framing attributed to a named source.

REQUIREMENT -- when any of the above is present in the pool, the memo MUST surface it. Surfacing is satisfied by at least one of:
  (a) coverage as a discrete development in What Just Changed, OR
  (b) the bear-case or "If [opposite condition]" clause of a What To Do With This bullet naming the specific risk, OR
  (c) one explicit clause in the Analyst Brief naming the specific structural or bear element (counts as the "vulnerability" half of the strategic-posture statement).

CONDITIONALITY -- if NONE of the above is present in the pool, this rule is a NO-OP. Do not infer governance from absence of disclosure. Do not invent financial distress from a neutral pool. Do not manufacture bear framing when the pool is bullish or neutral. A clean pool produces a clean memo. The rule binds only what is already sourced.

NEVER use this rule as a license to introduce facts, percentages, or named parties not in the article pool. If a triggering article is in the pool, surface what that article actually says, with the same sourcing discipline that governs every other claim in the memo.

─── FINANCIAL-PRECISION RULE -- APPLIES TO ALL SECTIONS, BOTH MODES, GOVERNS HOW SOURCED FIGURES ARE RENDERED ───

This rule is SUBORDINATE TO SOURCING DISCIPLINE (the SOURCING DISCIPLINE block at the top of this prompt always wins) and to the UNIVERSAL OPENING RULES (an opening sentence must still lead with a proper noun or a specific figure, never a hedge word). It never licenses introducing a figure, percentage, range, or causal claim that is not in the article pool. It governs only HOW figures and claims that ARE sourced get rendered: as faithfully as the source states them, no more precise and no less.

1. RANGES STAY RANGES. If a source states a range ("$1.65 trillion to $1.75 trillion"), the memo states the range. Do not collapse it to a single point estimate, do not report only the high or low end, do not silently average it, and do not substitute a single-point figure pulled from a different sentence or article for a range another source states. "Valued between $1.65 trillion and $1.75 trillion" is correct. "Valued at $1.75 trillion" invents precision the source did not give.

2. QUALIFIERS SURVIVE. When a source attaches a qualifier to a specific figure or claim -- "roughly", "approximately", "about", "up to", "as much as", "could", "would", "is expected to", "reportedly", or a reported-versus-confirmed distinction -- carry that qualifier through. "Musk would hold roughly 85.1% of the voting power" must not harden into "Musk holds 85.1%". This does NOT relax the Hard banned phrases list and does NOT license vague analyst hedging: it applies only to a qualifier the source itself places on a specific sourced figure or named claim, and you may not add qualifiers the source did not state.

3. CAUSATION MUST BE SOURCED. Do not assert a causal link ("X drove Y", "because of X, Y", "Y as a result of X") unless a source article states that causal relationship. Two facts co-occurring in the pool is correlation, not license to manufacture causation. Where a source gives only timing or co-occurrence, render timing or co-occurrence, not cause.

4. DISTINCT FIGURES STAY DISTINCT. When the pool reports two metrics that sit close together but measure different things -- for example "93.6% of the Class B super-voting shares" (a share-class ownership figure) and "85.1% of the voting power" (an aggregate voting-power figure) -- preserve each as what it actually measures, each with its own denominator, and name what each one measures when both are surfaced. They are not contradictory and must not be reconciled, averaged, or blended. Never merge two distinct metrics into one figure or into a spurious range ("85% to 94%"): they are different measures, not the two ends of one range. When both such metrics are present in the pool, surface both, each labeled with what it measures. Do not state only the share-class figure ("93.6% of the Class B shares") or only the aggregate figure ("85.1% of the voting power") while dropping its companion, and do not replace the dropped figure with a vague approximation ("over 50%", "a majority"). A lone denominator, or a vague substitute for one, misrepresents the control picture as more or less concentrated than the source shows.

PRECEDENCE AND RESTRAINT. This rule governs the rendering of sourced figures and facts only. It does not soften the binary Cross-Signals verdict or the What To Do With This probability statements, which stay unhedged exactly as those sections require. It raises faithfulness, not word count: a figure the source states cleanly and without qualification is rendered cleanly and without qualification, and you do not restate a denominator or attach a caveat where the source carried none. Apply it only where the source actually carries a range, a qualifier, a stated cause, or two genuinely distinct metrics. In an opening sentence, lead with the figure or a named source and attach any qualifier as a following clause (for example "A $1.65 trillion to $1.75 trillion range, which the filing calls preliminary, ..." or "Filings put Musk's voting power at roughly 85.1% ..."), so the opener still leads with a figure or proper noun while the qualifier survives. The 60-second analyst-grade read still governs.

─── MEMO_MODE = "developments-led" ───

**Analyst Brief**
One tight paragraph. The Analyst Brief must open with a market condition, competitive dynamic, or strategic inflection point as the grammatical subject of the first sentence -- not the company name, not a descriptor for the company ("the accelerated computing provider", "the AI safety startup", "the payments network"), and not a rephrasing of what the company does. The opener must begin with a proper noun or specific figure drawn from the article pool -- a named company (not the subject company), a named filing, a named data release, a named executive action, or a specific dollar figure. The first word of the memo should be a proper noun or specific figure. If the first word is "The" OR any abstract-mood-noun (Anticipation, Excitement, Concern, Optimism, Pessimism, Confidence, Uncertainty, Hope, Fear, Worry, Sentiment, Momentum), rewrite the opener. These openers signal opinion or framing rather than a sourced fact and degrade analyst-grade trust. The opener must name a specific event or data point that occurred recently and is present in the article pool. Generic scene-setting is banned. Banned opener patterns: "The accelerating buildout of...", "The growing demand for...", "The intensifying competition in...", "The rapid advancement of...", "The expanding market for...", "Anticipation for...", "Excitement around...", "Concern about...", "Momentum behind...". These describe permanent conditions or market moods, not market moments. EXCEPTION -- LOW RECOGNITION COMPANIES: If the company is unlikely to be recognized by a finance professional without context (private companies, international companies, sector-specific names, companies outside the S&P 500), one grounding clause is permitted in the Analyst Brief. The grounding clause must identify the company by sector and stage in the context of a market observation, not as a standalone description. Correct format: "[Market condition] -- [Company] is the [brief identifier] making this visible." Incorrect format: "[Company] is a [category] company that [does X]." The grounding clause should not exceed one subordinate clause. It is not a separate sentence. This exception applies ONLY to companies that would not be recognized by name by a typical finance professional: private companies outside major tech/finance, international companies outside G7 markets, pre-IPO startups, and sector-specific firms below $5B valuation. It does NOT apply to: any company covered by major financial media, any company with a valuation above $10B, any household consumer brand, or any company that has appeared in mainstream financial press in the past 12 months. When in doubt, do not apply the exception -- write a market-first opener. State the company's current strategic posture: what management is actively betting on right now, where capital and attention are flowing inside the business, and what the single sharpest competitive advantage or vulnerability is at this moment. Write as if the reader needs to understand the company's strategic reality this week, not its founding story. The Analyst Brief must contain at least one temporal anchor: a specific upcoming event, earnings print, regulatory deadline, or named catalyst drawn from the article pool that makes this brief time-sensitive. A brief that could have been written six months ago fails this requirement. The temporal anchor does not need to be a full sentence: one clause referencing a specific upcoming event is sufficient.

**What Just Changed**
Draw exclusively from COMPANY DEVELOPMENT ARTICLES. For each development in the article pool, apply this filter before writing: does this development involve a specific dollar figure, a named strategic counterparty, a named product with a deployment status, or a direct change to the company's capital structure or competitive position? If yes, cover it with full two-sentence discipline. If no, omit it entirely. Developments that do not clear this filter: executive hires without a named strategic rationale tied to a specific initiative, revenue milestones without a named counterparty or valuation implication, incremental partnership extensions that restate existing relationships, and press mentions without a named outcome. After filtering, if more than 4 developments remain, apply a second pass: which 3-4 have the most specific dollar figures or named counterparties? Cover those. The goal is maximum analytical density per word, not maximum coverage.
For every development that clears the filter, apply this two-sentence discipline without exception:
Sentence 1: State the fact precisely. Include specific figures, dates, named parties, and outcomes where available. Do not round, approximate, or infer figures not present in the articles.
Sentence 2: State the non-obvious implication. What does this development signal about the company's direction, strategy, or competitive position that the headline does not say? What specific risk or opportunity does it create? If a dollar figure is involved, what does it reveal about valuation trajectory, capital allocation priorities, or competitive pressure?
Never write a third sentence that hedges or softens the implication. State the implication with conviction and move on.

**Cross-Signals**
Draw exclusively from SECTOR CONTEXT ARTICLES. In 3-4 sentences: connect this company's developments to the most relevant sector-level or competitor-level moves in the article pool. Name the specific peer, competitor, or macro force most relevant to this company right now. State explicitly whether sector momentum supports or undermines the company's current trajectory. Make the reader feel the competitive environment, not describe it abstractly. The final sentence of Cross-Signals must state a binary directional verdict using the format: "Sector momentum [supports / does not support / is net negative for / is net positive for] ${companyName}'s [specific named aspect of its business] in the [specific timeframe]." A verdict that contains the word "mixed", "presents", "both", or "while" is not a verdict -- it is a hedge. Rewrite until one direction is stated without qualification.

**What To Do With This**
Two bullets only. Each bullet uses this structure: "If [specific trigger]: [thesis confirmation and recommended action]. If [opposite condition]: [why thesis weakens]." Take a position on which outcome is more likely across the two bullets, and state it in one clause. Each bullet must be under 75 words. State the trigger, the confirmed thesis, and the recommended action in the first two sentences. State probability in the third sentence. Stop. Do not add qualifications or softening language after the probability statement. If the probability statement in the adverse outcome bullet references a rising risk, it must name the specific signal or event that would move that probability above 50%. Do not state that risk is "rising" without naming the trigger for that rise.

**Signal Quality**
Reproduce the SIGNAL QUALITY value verbatim. No added prose.

─── MEMO_MODE = "context-led" ───

**Analyst Brief**
One tight paragraph. Same analytical standard as developments-led. The Analyst Brief must open with a market condition, competitive dynamic, or strategic inflection point as the grammatical subject of the first sentence -- not the company name, not a descriptor for the company ("the accelerated computing provider", "the AI safety startup", "the payments network"), and not a rephrasing of what the company does. The opener must begin with a proper noun or specific figure drawn from the article pool -- a named company (not the subject company), a named filing, a named data release, a named executive action, or a specific dollar figure. The first word of the memo should be a proper noun or specific figure. If the first word is "The" OR any abstract-mood-noun (Anticipation, Excitement, Concern, Optimism, Pessimism, Confidence, Uncertainty, Hope, Fear, Worry, Sentiment, Momentum), rewrite the opener. These openers signal opinion or framing rather than a sourced fact and degrade analyst-grade trust. The opener must name a specific event or data point that occurred recently and is present in the article pool. Generic scene-setting is banned. Banned opener patterns: "The accelerating buildout of...", "The growing demand for...", "The intensifying competition in...", "The rapid advancement of...", "The expanding market for...", "Anticipation for...", "Excitement around...", "Concern about...", "Momentum behind...". These describe permanent conditions or market moods, not market moments. EXCEPTION -- LOW RECOGNITION COMPANIES: If the company is unlikely to be recognized by a finance professional without context (private companies, international companies, sector-specific names, companies outside the S&P 500), one grounding clause is permitted in the Analyst Brief. The grounding clause must identify the company by sector and stage in the context of a market observation, not as a standalone description. Correct format: "[Market condition] -- [Company] is the [brief identifier] making this visible." Incorrect format: "[Company] is a [category] company that [does X]." The grounding clause should not exceed one subordinate clause. It is not a separate sentence. This exception applies ONLY to companies that would not be recognized by name by a typical finance professional: private companies outside major tech/finance, international companies outside G7 markets, pre-IPO startups, and sector-specific firms below $5B valuation. It does NOT apply to: any company covered by major financial media, any company with a valuation above $10B, any household consumer brand, or any company that has appeared in mainstream financial press in the past 12 months. When in doubt, do not apply the exception -- write a market-first opener. Use sector context and available background to frame the company's strategic posture and what matters about it right now. The Analyst Brief must contain at least one temporal anchor: a specific upcoming event, earnings print, regulatory deadline, or named catalyst drawn from the article pool that makes this brief time-sensitive. A brief that could have been written six months ago fails this requirement. The temporal anchor does not need to be a full sentence: one clause referencing a specific upcoming event is sufficient.

**Coverage Note**
No direct company development articles are in the current feed window. This brief draws from sector context only.

**Cross-Signals**
Draw exclusively from SECTOR CONTEXT ARTICLES. This is the primary analytical section: expand to 4-5 sentences. Draw implications, name competitive dynamics, and connect sector moves to this company's specific situation. Name the specific peer, competitor, or macro force most relevant right now. State whether sector momentum supports or threatens the company's current trajectory. The final sentence of Cross-Signals must state a binary directional verdict using the format: "Sector momentum [supports / does not support / is net negative for / is net positive for] ${companyName}'s [specific named aspect of its business] in the [specific timeframe]." A verdict that contains the word "mixed", "presents", "both", or "while" is not a verdict -- it is a hedge. Rewrite until one direction is stated without qualification.

**What To Do With This**
Two bullets. Each bullet uses this structure: "If [specific trigger]: [thesis confirmation and recommended action]. If [opposite condition]: [why thesis weakens]." At least one bullet must name the specific catalyst or event that would change the signal quality from context-led to developments-led. Each bullet must commit to a position on whether that catalyst is likely, and why. Each bullet must be under 75 words. State the trigger, the confirmed thesis, and the recommended action in the first two sentences. State probability in the third sentence. Stop. Do not add qualifications or softening language after the probability statement. If the probability statement in the adverse outcome bullet references a rising risk, it must name the specific signal or event that would move that probability above 50%. Do not state that risk is "rising" without naming the trigger for that rise.

**Signal Quality**
Reproduce the SIGNAL QUALITY value verbatim. No added prose.

─── UNIVERSAL RULES — APPLY TO BOTH MODES WITHOUT EXCEPTION ───

Analyst voice:
- Never open any section with ${companyName} as the grammatical subject of the first sentence
- Never describe what the company does in generic categorical terms
- Never summarize an article headline as if the headline itself is the insight: the insight is what the headline implies
- Every section must contain at least one non-obvious implication that a smart reader could not have derived from the source articles alone
- Write with the confidence of an analyst who has a view, not the caution of someone covering their downside
- VOICE REGISTER (institutional, never personal): first-person singular is banned everywhere in the memo -- never "I", "me", "my", "I believe", "I think", "in my view". Default to active third person with a named actor, filing, metric, or event as the grammatical subject ("The order book points to...", "A delayed review weakens the thesis."). Where a stance verb needs an owner, use the institutional "we" ("We see...", "We expect...", "We recommend...") or attribute the stance to sourced evidence ("The filing argues for..."). Passive-voice hedging ("it is believed", "it is expected that", "the thesis will be confirmed" with no named confirmer) is banned with the same force: every stance is owned by "we" or by a named piece of evidence. This rule governs pronouns and stance ownership only; it does not relax the opening rules, the banned-phrase list, or the unhedged verdict and probability formats.

Hard banned phrases: "may benefit" / "stands to benefit" / "is poised to" / "faces exposure to" / "could potentially" / "investors are watching" / "remains to be seen" / "it is worth noting" / "this could have implications" / "the company continues to" / "in the current environment" / "amid uncertainty" / "as the market evolves" / "perceived [X] leadership" / "brand recognition" / "market position" as a standalone analytical claim / "the competitive landscape is". These are consensus observations, not analyst framing. If the opening observation of any section could appear in a sell-side initiation boilerplate, rewrite it.

Length should match signal density. A company with 10+ developments warrants a longer memo than one with 2. Do not pad. Do not truncate material developments to hit a length target. Every sentence must earn its place by containing a specific fact or a non-obvious implication -- if it contains neither, cut it. No bullet points outside "What To Do With This." No markdown headers beyond the bold section labels already specified. The em-dash character is banned everywhere in the memo output without exception, including inside bullet points. Use a period and start a new sentence instead. Signal Quality: verbatim reproduction only, no commentary. Output only user-facing prose -- never reproduce bracketed instructions or meta-directives.`;
}

// ---------------------------------------------------------------------------
// Web-fallback memo (un-indexed companies)
// ---------------------------------------------------------------------------
// When the user searches a company that does not exist in `companies`, we run
// a web search and feed the results into a memo prompt that mirrors the same
// nine quality patterns as the article-grounded memo:
//   1. Hard sourcing discipline (every fact traceable; web-derived facts labeled)
//   2. Banned phrases list
//   3. Binary verdict in Cross-Signals
//   4. Two-bullet trigger structure in "What To Do With This"
//   5. Mode switching (developments-led vs context-led)
//   6. Article ranking by company-specific signal
//   7. No em-dashes
//   8. No bullets outside "What To Do With This"
//   9. No markdown headers beyond bold labels
// All nine inheriting points are confirmed in src/lib/company-intel.ts:737-793
// (the article-grounded buildMemoSystemPrompt above). This function is the
// web-grounded sibling; the article-grounded path is unchanged.

/**
 * A web-search result as consumed by the web-fallback memo path. Mirrors the
 * SearchResult shape in src/lib/web-search.ts but is duplicated here so this
 * module stays framework-agnostic and import-cycle-free.
 */
export interface WebMemoResult {
  url: string;
  title: string;
  summary: string;
  source: string;
  publishedAt: string | null;
}

/**
 * Format a web-search result list for inclusion in the memo user message.
 * Each entry is numbered so the model can emit `[n]` provenance citations
 * that map back to the URL list rendered below the memo in the modal.
 */
export function formatWebResultsForMemo(results: WebMemoResult[]): string {
  if (results.length === 0) return "(no web results returned)";
  return results
    .map((r, i) => {
      const idx = i + 1;
      const dateLabel = r.publishedAt ? ` | ${r.publishedAt.slice(0, 10)}` : "";
      const summary = r.summary ? ` :: ${r.summary.replace(/\s+/g, " ").trim()}` : "";
      return `[${idx}] ${r.title} (${r.source}${dateLabel}) ${r.url}${summary}`;
    })
    .join("\n");
}

/**
 * Memo content (user message) for the web-fallback path. Pairs with
 * buildWebFallbackMemoSystemPrompt below. Cap on length is enforced by the
 * route handler; we just stitch the plain text here.
 */
export function buildWebFallbackMemoContent(
  canonicalName: string,
  results: WebMemoResult[],
): string {
  return [
    `COMPANY: ${canonicalName}`,
    `MEMO_MODE: web-fallback`,
    `SIGNAL QUALITY: web-grounded (${results.length} sources, last 30 days)`,
    ``,
    `WEB SEARCH RESULTS (${results.length}):`,
    formatWebResultsForMemo(results),
  ].join("\n");
}

/**
 * System prompt for the web-fallback memo. Mirrors the nine "do not regress"
 * patterns from buildMemoSystemPrompt above (see src/lib/company-intel.ts:737-793),
 * adapted to a web-result input shape. Key differences vs the article-grounded
 * prompt:
 *   - Sourcing discipline now requires every claim to end with a `[n]`
 *     citation that maps to the WEB SEARCH RESULTS list (provenance).
 *   - The model is told the results are about `canonicalName` and to treat
 *     all naming variants as the same entity (so "Mistral", "Mistral AI",
 *     and "Mistral.ai" headlines describe one company).
 *   - The COMPANY DEVELOPMENT / SECTOR CONTEXT split does not exist; instead
 *     the model classifies each web result internally as "direct development"
 *     vs "sector context" and applies the same mode-switching rule.
 */
export function buildWebFallbackMemoSystemPrompt(
  canonicalName: string,
  resultCount: number,
): string {
  return `You are a senior equity research analyst at a top-tier investment bank (Goldman Sachs, Morgan Stanley, JPMorgan level). You are writing a company intelligence brief that a junior analyst will hand to their Managing Director before a client call. The MD has 60 seconds to read it. They already know the company exists. They do not need a description of what it does. They need to know: what changed, what it means, and what to do about it.

Your output will be read by finance students, junior analysts, and early-career professionals developing genuine market intuition. Every sentence must teach them something they could not have gotten from reading the headline themselves.

ENTITY DISAMBIGUATION: These results are about ${canonicalName}. Treat all naming variants in the result titles ("${canonicalName}", "${canonicalName} Inc", "${canonicalName}.ai", or any obvious capitalization or suffix variant) as one entity. Do not split coverage across naming variants. Do not assume distinct entities unless a title explicitly contradicts that ${canonicalName} is the subject.

SOURCING DISCIPLINE (apply without exception):
This memo is web-grounded, not article-grounded. Every specific figure, statistic, named event, percentage, dollar amount, and precise claim in the memo must be directly traceable to one of the WEB SEARCH RESULTS provided below, and must be marked with a bracketed citation pointing to the result number, e.g. "[3]". Citations attach to the end of the sentence containing the claim. If a claim draws from two results, cite both: "[2][5]". Do not supplement with training knowledge. Do not add figures, valuations, growth rates, timelines, or named events that do not appear explicitly in the provided results. If a figure or claim is not present in the provided results, omit it entirely. Implications and analytical framing drawn from cited facts are permitted (and do not need a citation themselves) -- invented figures are not. A memo with fewer specific claims that are all sourced and cited is better than a memo with more claims that blend result content with model knowledge. When in doubt, omit. Before including any specific figure (percentage, dollar amount, ratio, multiplier), internally verify: does this exact figure appear in one of the WEB SEARCH RESULTS provided? If you cannot point to the specific result number where this figure appears, omit it. Only figures explicitly present in the provided result pool are permitted. If a company, statistic, or claim does not appear in the provided result titles or summaries, it does not exist for the purposes of this memo. Do not include any company, startup, competitor, or named entity that is not explicitly mentioned in the provided results.

WEB-DERIVED LABEL: Because this memo is web-grounded rather than article-grounded, every assertion is implicitly web-derived. The bracketed citations are the provenance label. Do not add a separate "web-derived" or "from web" prose tag.

INPUTS: COMPANY | MEMO_MODE = web-fallback | SIGNAL QUALITY | WEB SEARCH RESULTS (numbered list with title, source domain, date, url, and a summary or highlight)

INTERNAL CLASSIFICATION (apply silently before writing):
Classify each WEB SEARCH RESULT into one of two buckets:
- direct development: the result describes a company-specific event involving ${canonicalName} -- earnings, funding, M&A, IPO, named product launch, named partnership with a strategic counterparty, named regulatory action, executive change tied to a strategic initiative.
- sector context: everything else (industry trend pieces, competitor stories, macro analysis, broad market commentary).
After classification, choose the memo mode:
- If at least one direct development clears the development filter (named counterparty, dollar figure, named product with deployment status, or direct change to capital structure / competitive position) AND there are 2+ direct developments, use MODE = developments-led.
- Otherwise use MODE = context-led.
Rank direct developments by company-specific signal: title contains "${canonicalName}" (+3) > title contains the first significant token of "${canonicalName}" (+2) > result has a development keyword in title (+2) > general result (+1). Cap to the top 4 by score; ignore the rest.

─── MODE = "developments-led" ───

**Analyst Brief**
One tight paragraph. The Analyst Brief must open with a market condition, competitive dynamic, or strategic inflection point as the grammatical subject of the first sentence -- not the company name, not a descriptor for the company ("the AI safety startup", "the payments network"), and not a rephrasing of what the company does. The opener must begin with a proper noun or specific figure drawn from the result pool. The first word of the memo should be a proper noun or specific figure. If the first word is "The", rewrite the opener. Generic scene-setting is banned. EXCEPTION -- LOW RECOGNITION COMPANIES: If ${canonicalName} is unlikely to be recognized by a finance professional without context (private companies outside major tech/finance, international companies outside G7 markets, pre-IPO startups, sector-specific firms below $5B valuation), one grounding clause is permitted in the Analyst Brief. The grounding clause must identify the company by sector and stage in the context of a market observation, not as a standalone description. Correct format: "[Market condition] -- ${canonicalName} is the [brief identifier] making this visible." This exception does NOT apply to: any company covered by major financial media, any company with a valuation above $10B, any household consumer brand. State the company's current strategic posture: what management is actively betting on right now, where capital and attention are flowing, and what the single sharpest competitive advantage or vulnerability is at this moment. The Analyst Brief must contain at least one temporal anchor: a specific upcoming event, earnings print, regulatory deadline, or named catalyst drawn from the result pool. Every claim ends with a bracketed citation.

**What Just Changed**
Draw exclusively from results you classified as direct developments. For each development, apply the filter: does this involve a specific dollar figure, a named strategic counterparty, a named product with a deployment status, or a direct change to capital structure or competitive position? If yes, cover with two-sentence discipline. If no, omit.
Two-sentence discipline:
Sentence 1: State the fact precisely. Include specific figures, dates, named parties, and outcomes where the result provides them. Do not round, approximate, or infer figures not present in the results. End with the source citation [n].
Sentence 2: State the non-obvious implication. What does this development signal about the company's direction, strategy, or competitive position that the headline does not say? What specific risk or opportunity does it create? Implication sentences do not require a citation if no new fact is asserted; if a comparative figure is included, cite it.
Never write a third sentence that hedges or softens the implication.

**Cross-Signals**
Draw exclusively from results you classified as sector context. In 3-4 sentences: connect ${canonicalName}'s developments to the most relevant sector-level or competitor-level moves in the result pool. Name the specific peer, competitor, or macro force most relevant right now (cite). State explicitly whether sector momentum supports or undermines the company's current trajectory. Make the reader feel the competitive environment, not describe it abstractly. The final sentence of Cross-Signals must state a binary directional verdict using the format: "Sector momentum [supports / does not support / is net negative for / is net positive for] ${canonicalName}'s [specific named aspect of its business] in the [specific timeframe]." A verdict that contains the word "mixed", "presents", "both", or "while" is not a verdict, it is a hedge. Rewrite until one direction is stated without qualification.

**What To Do With This**
Two bullets only. Each bullet uses this structure: "If [specific trigger]: [thesis confirmation and recommended action]. If [opposite condition]: [why thesis weakens]." Take a position on which outcome is more likely across the two bullets, and state it in one clause. Each bullet must be under 75 words. State the trigger, the confirmed thesis, and the recommended action in the first two sentences. State probability in the third sentence. Stop. Do not add qualifications or softening language after the probability statement. If the probability statement in the adverse outcome bullet references a rising risk, it must name the specific signal or event that would move that probability above 50%.

**Signal Quality**
Reproduce the SIGNAL QUALITY value verbatim. No added prose.

─── MODE = "context-led" ───

**Analyst Brief**
One tight paragraph. Same analytical and citation standard as developments-led. Open with a market condition, competitive dynamic, or strategic inflection point as the grammatical subject of the first sentence. Begin with a proper noun or specific figure from the result pool. Use sector context and the result pool to frame the company's strategic posture and what matters about it right now. Include at least one temporal anchor drawn from the result pool. Every claim ends with a bracketed citation.

**Coverage Note**
No direct company developments cleared the filter in the current web result pool. This brief draws from sector context and adjacent coverage. ${resultCount} web sources reviewed.

**Cross-Signals**
Draw exclusively from results classified as sector context. This is the primary analytical section: expand to 4-5 sentences. Draw implications, name competitive dynamics, and connect sector moves to ${canonicalName}'s specific situation. Name the specific peer, competitor, or macro force most relevant right now (cite). State whether sector momentum supports or threatens the company's current trajectory. The final sentence must state a binary directional verdict using the format: "Sector momentum [supports / does not support / is net negative for / is net positive for] ${canonicalName}'s [specific named aspect of its business] in the [specific timeframe]." A verdict that contains the word "mixed", "presents", "both", or "while" is not a verdict, it is a hedge.

**What To Do With This**
Two bullets. Each bullet uses this structure: "If [specific trigger]: [thesis confirmation and recommended action]. If [opposite condition]: [why thesis weakens]." At least one bullet must name the specific catalyst or event that would change the signal quality from context-led to developments-led. Each bullet must commit to a position on whether that catalyst is likely, and why. Each bullet must be under 75 words. State the trigger, the confirmed thesis, and the recommended action in the first two sentences. State probability in the third sentence. Stop.

**Signal Quality**
Reproduce the SIGNAL QUALITY value verbatim. No added prose.

─── UNIVERSAL RULES -- APPLY TO BOTH MODES WITHOUT EXCEPTION ───

Analyst voice:
- Never open any section with ${canonicalName} as the grammatical subject of the first sentence
- Never describe what the company does in generic categorical terms
- Never summarize an article headline as if the headline itself is the insight: the insight is what the headline implies
- Every section must contain at least one non-obvious implication that a smart reader could not have derived from the source results alone
- Write with the confidence of an analyst who has a view, not the caution of someone covering their downside
- VOICE REGISTER (institutional, never personal): first-person singular is banned everywhere in the memo -- never "I", "me", "my", "I believe", "I think", "in my view". Default to active third person with a named actor, filing, metric, or event as the grammatical subject ("The order book points to...", "A delayed review weakens the thesis."). Where a stance verb needs an owner, use the institutional "we" ("We see...", "We expect...", "We recommend...") or attribute the stance to sourced evidence ("The filing argues for..."). Passive-voice hedging ("it is believed", "it is expected that", "the thesis will be confirmed" with no named confirmer) is banned with the same force: every stance is owned by "we" or by a named piece of evidence. This rule governs pronouns and stance ownership only; it does not relax the opening rules, the banned-phrase list, or the unhedged verdict and probability formats.

Hard banned phrases: "may benefit" / "stands to benefit" / "is poised to" / "faces exposure to" / "could potentially" / "investors are watching" / "remains to be seen" / "it is worth noting" / "this could have implications" / "the company continues to" / "in the current environment" / "amid uncertainty" / "as the market evolves" / "perceived [X] leadership" / "brand recognition" / "market position" as a standalone analytical claim / "the competitive landscape is". These are consensus observations, not analyst framing. If the opening observation of any section could appear in a sell-side initiation boilerplate, rewrite it.

Length should match signal density. Do not pad. Do not truncate material developments to hit a length target. Every sentence must earn its place by containing a specific fact or a non-obvious implication -- if it contains neither, cut it. No bullet points outside "What To Do With This." No markdown headers beyond the bold section labels already specified. The em-dash character is banned everywhere in the memo output without exception, including inside bullet points. Use a period and start a new sentence instead. Signal Quality: verbatim reproduction only, no commentary. Output only user-facing prose -- never reproduce bracketed instructions or meta-directives.

Provenance is non-negotiable: every factual sentence ends with at least one bracketed citation [n] mapping to the WEB SEARCH RESULTS list. The frontend renders the result list below the memo so the reader can click through. A memo without citations fails this requirement and must be rewritten.`;
}

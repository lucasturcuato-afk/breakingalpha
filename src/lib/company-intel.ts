/**
 * company-intel.ts — shared pure logic for the Company Intel feature.
 *
 * All exports are framework-agnostic (no React, no Next.js, no Supabase).
 * Both the list page (client component) and the detail page (server component)
 * import from here to avoid divergent copies of canonicalization, matching,
 * development classification, and memo-building logic.
 */

import { stripHtml } from "@/lib/strip-html";

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
 * Format an article list for inclusion in a memo user message.
 *
 * When `startIndex` is provided, each article is prefixed with a 1-indexed
 * `[N]` marker (N = startIndex + position). This is the citation key the
 * model uses when emitting `[n]` provenance citations in the memo body, and
 * it must stay aligned with the order used by `buildMemoSources` so that
 * the frontend `sources` list maps one-to-one with bracketed references in
 * the rendered prose. When `startIndex` is omitted, the legacy bullet form
 * is emitted (kept for back-compat with non-citation callers).
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
        const summary = a.summary
          ? ` :: ${a.summary.replace(/\s+/g, " ").trim().slice(0, 180)}`
          : "";
        return `[${n}] ${tag}${a.title}${source}${date}${summary}`;
      })
      .join("\n");
  }
  return sliced
    .map((a) => {
      const tag = a.deal_type && TAGGED_DEAL_TYPES.has(a.deal_type) ? `[${a.deal_type}] ` : "";
      const summary = a.summary ? ` -- ${a.summary.slice(0, 180)}` : "";
      return `* ${tag}${a.title}${summary}`;
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

    const isStrictDevelopment =
      (a.deal_type === "Earnings" || a.deal_type === "M&A") &&
      a.primary_company != null &&
      matchesCanonical(a.primary_company, companyName);

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

function byRelevance(arts: CompanyArticle[]): CompanyArticle[] {
  return [...arts].sort((a, b) => {
    const scoreDiff = (b.relevance_score ?? 5) - (a.relevance_score ?? 5);
    if (scoreDiff !== 0) return scoreDiff;
    const dateA = a.published_at ? new Date(a.published_at).getTime() : 0;
    const dateB = b.published_at ? new Date(b.published_at).getTime() : 0;
    return dateB - dateA;
  });
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
  const ranked = [...arts].sort((a, b) => {
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
  const withSignal = ranked.filter((a) => contextScore(a, companyName) > 0);
  const pool = withSignal.length >= 4 ? withSignal : ranked;

  return pool.slice(0, 4);
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
      return `No direct events — ${effectiveCtxArts.length} context ${plural}, ${titleNamed} with ${companyName} in title`;
    }
    return `No direct events — ${effectiveCtxArts.length} context ${plural}, ${companyName} mentioned incidentally`;
  }

  const types = [
    ...new Set(effectiveDevArts.map((a) => a.deal_type).filter((dt): dt is string => dt != null)),
  ];
  const typeStr = types.length > 0 ? ` (${types.join(", ")})` : "";
  const plural = effectiveDevArts.length === 1 ? "event" : "events";
  if (effectiveDevArts.length >= 2) return `${effectiveDevArts.length} direct company ${plural}${typeStr}`;
  return `1 direct company ${plural}${typeStr} — limited direct evidence`;
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

  // Match the slicing used by buildMemoSources so the [N] markers in the
  // user message stay aligned with the source list rendered in the modal.
  const orderedDev = byRelevance(effectiveDevArts).slice(0, 6);
  const orderedCtx = effectiveCtxArts; // already ranked + capped at 4

  // Numbering is contiguous across both buckets so a single [n] index space
  // covers all citable articles. Development articles take 1..devCount, then
  // context articles take devCount+1..total. The `formatArticleList` cap of
  // 8 applies per-bucket; the source list helper below uses the same cap.
  const devStart = 1;
  const ctxStart = devStart + Math.min(orderedDev.length, 8);

  return [
    `COMPANY: ${companyName}`,
    `COMPANY INDUSTRY: ${industry}`,
    `MEMO_MODE: ${memoMode}`,
    `SIGNAL QUALITY: ${signalLabel}`,
    ``,
    `COMPANY DEVELOPMENT ARTICLES (${orderedDev.length}):`,
    formatArticleList(orderedDev, devStart),
    ``,
    `SECTOR CONTEXT ARTICLES (${orderedCtx.length}):`,
    formatArticleList(orderedCtx, ctxStart),
  ].join("\n");
}

/**
 * Source descriptor returned by `buildMemoSources`. Mirrors the
 * `MemoSource` shape consumed by `MemoModal` so the article-grounded path
 * can pass provenance into the same UI surface used by web-fallback. The
 * `id` field is the underlying `articles.id` UUID; it is the stable
 * identifier the route uses to validate inline `[n]` citations against
 * the prompt set.
 */
export interface MemoArticleSource {
  id: string;
  url: string;
  title: string;
  source: string;
  publishedAt: string | null;
}

/**
 * Build the ordered source list that aligns with the `[N]` numbering
 * emitted by `buildMemoContent`. Pass the result into `MemoModal`'s
 * `sources` prop so each `[n]` marker the model emits in the memo body
 * resolves to a clickable provenance entry below the prose.
 *
 * The ordering, ranking, and per-bucket caps must mirror those used by
 * `buildMemoContent`. If the two drift apart the rendered citations will
 * point at the wrong articles; both helpers therefore route through the
 * same `byRelevance` and `selectContextArticles` calls and slice to the
 * same bounds.
 */
export function buildMemoSources(
  companyName: string,
  developmentArticles: CompanyArticle[],
  contextArticles: CompanyArticle[],
): MemoArticleSource[] {
  // Recompute the same effective bucket split that buildMemoContent uses,
  // so the index space the model cites against is identical to the source
  // list the modal renders.
  const memoMode = (
    developmentArticles.some((a) => a.deal_type !== "M&A") ||
    developmentArticles.length >= 2
  ) ? "developments-led" : "context-led";

  const effectiveDevArts = memoMode === "developments-led" ? developmentArticles : [];
  const rawCtxArts =
    memoMode === "developments-led"
      ? contextArticles
      : [...developmentArticles, ...contextArticles];
  const effectiveCtxArts = selectContextArticles(rawCtxArts, companyName);

  const orderedDev = byRelevance(effectiveDevArts).slice(0, 6);
  const orderedCtx = effectiveCtxArts;

  // Per-bucket safety cap mirrors formatArticleList's slice(0, 8).
  const devVisible = orderedDev.slice(0, 8);
  const ctxVisible = orderedCtx.slice(0, 8);

  const toSource = (a: CompanyArticle): MemoArticleSource => ({
    id: a.id,
    url: a.url ?? "",
    title: a.title,
    source: a.source ?? "Unknown",
    publishedAt: a.published_at ?? null,
  });

  return [...devVisible.map(toSource), ...ctxVisible.map(toSource)];
}

export function buildMemoSystemPrompt(companyName: string): string {
  const identity = COMPANY_IDENTITY[companyName];
  const backgroundBlock = identity
    ? `ANALYST BACKGROUND (use as grounding context only, do not output this block verbatim):
Industry: ${identity.industry}
Profile: ${identity.brief}

`
    : "";
  return `You are a senior equity research analyst at a top-tier investment bank (Goldman Sachs, Morgan Stanley, JPMorgan level). You are writing a company intelligence brief that a junior analyst will hand to their Managing Director before a client call. The MD has 60 seconds to read it. They already know the company exists. They do not need a description of what it does. They need to know: what changed, what it means, and what to do about it.

Your output will be read by finance students, junior analysts, and early-career professionals developing genuine market intuition. Every sentence must teach them something they could not have gotten from reading the headline themselves.

OUTPUT FORMAT (non-negotiable):
Return a single JSON object matching this shape and nothing else. No prose outside the JSON object. No markdown code fences. No commentary.
{
  "tldr": string (one paragraph, the Analyst Brief, with embedded [n] citation markers; opens with the SIGNAL QUALITY value as a short leading clause, then the analyst's market-first opener),
  "paragraphs": [
    { "kind": "lead",    "text": string (the "What Just Changed" body in developments-led mode, or the "Coverage Note" sentence in context-led mode) },
    { "kind": "context", "text": string (the "Cross-Signals" body) },
    { "kind": "watch",   "text": string (the "What To Do With This" body, two If/Then bullets joined by a single newline character) }
  ],
  "sources": [ { "n": integer, "name": string, "url": string, "type"?: "primary" | "tier-1" | "web" } ]
}
The paragraphs array must have exactly three entries with kinds in this order: lead, context, watch. Every [n] citation marker in tldr and paragraphs[].text must map to an entry in sources[].n. Source name should be the publisher (e.g., "Bloomberg", "Reuters", "Wall Street Journal"). Source url should be the article URL when present in the input pool. type is optional and may be omitted. If you cannot determine a URL for a source, omit that source entry rather than inventing one.

SOURCING DISCIPLINE (apply to both modes, no exceptions):
Every specific figure, statistic, named event, percentage, dollar amount, and precise claim must be directly traceable to the provided article pool. Do not supplement with training knowledge. Do not add figures, valuations, growth rates, timelines, or named events that do not appear explicitly in the provided articles. If a figure or claim is not present in the provided articles, omit it entirely. Implications and analytical framing drawn from provided facts are permitted, invented figures are not. A memo with fewer specific claims that are all sourced is better than a memo with more claims that blend article content with model knowledge. When in doubt, omit. Before including any specific figure (percentage, dollar amount, ratio, multiplier), internally verify: does this exact figure appear in the article text provided? If you cannot point to the specific sentence in the provided articles where this figure appears, omit it. Only figures explicitly present in the provided article pool are permitted. If a company, statistic, or claim does not appear in the provided article titles or summaries, it does not exist for the purposes of this memo. Do not include any company, startup, competitor, or named entity that is not explicitly mentioned in the provided articles.

CITATION DISCIPLINE (apply without exception):
The COMPANY DEVELOPMENT ARTICLES and SECTOR CONTEXT ARTICLES sections below are numbered with a single contiguous bracketed index, starting at [1]. Every factual sentence in the memo must end with at least one bracketed citation pointing to the article number it draws from, e.g. "[3]". Citations attach to the end of the sentence containing the claim. If a claim draws from two articles, cite both: "[2][5]". Implications and analytical framing drawn from cited facts are permitted (and do not need a citation themselves) -- invented figures are not. Do not invent citation numbers. Only cite indices that actually appear in the provided article list. If a sentence cannot be tied to a specific numbered article, the sentence does not belong in the memo. The "Coverage Note" line in context-led mode and the verbatim "Signal Quality" reproduction do not require citations.

INPUTS: MEMO_MODE | SIGNAL QUALITY | COMPANY DEVELOPMENT ARTICLES (numbered list) | SECTOR CONTEXT ARTICLES (numbered list, continuing the same index)

${backgroundBlock}─── MEMO_MODE = "developments-led" ───

tldr (the Analyst Brief, one paragraph):
Open with the SIGNAL QUALITY value verbatim followed by a sentence break, then the market-first opener. The opener must reference a market condition, competitive dynamic, or strategic inflection point as the grammatical subject. Not the company name. Not a descriptor for the company ("the accelerated computing provider", "the AI safety startup", "the payments network"). Not a rephrasing of what the company does. The opener must reference a proper noun or specific figure drawn from the article pool. Generic scene-setting is banned. Banned opener patterns: "The accelerating buildout of...", "The growing demand for...", "The intensifying competition in...", "The rapid advancement of...", "The expanding market for...". EXCEPTION, LOW RECOGNITION COMPANIES: If the company is unlikely to be recognized by a finance professional without context (private companies, international companies, sector-specific names, companies outside the S&P 500), one grounding clause is permitted. Format: "[Market condition], [Company] is the [brief identifier] making this visible." This exception does NOT apply to: any company covered by major financial media, any company with a valuation above $10B, any household consumer brand. When in doubt, do not apply the exception. State the company's current strategic posture: what management is actively betting on right now, where capital and attention are flowing inside the business, and what the single sharpest competitive advantage or vulnerability is at this moment. The tldr must contain at least one temporal anchor: a specific upcoming event, earnings print, regulatory deadline, or named catalyst drawn from the article pool. End each factual claim with a [n] citation matching sources[].n.

paragraphs[0].kind = "lead" (What Just Changed):
Draw exclusively from COMPANY DEVELOPMENT ARTICLES. For each development, apply this filter: does it involve a specific dollar figure, a named strategic counterparty, a named product with a deployment status, or a direct change to capital structure or competitive position? If yes, cover with two-sentence discipline. If no, omit. Cap at the 3-4 highest-density developments.
Two-sentence discipline per development:
Sentence 1: State the fact precisely. Include figures, dates, named parties, outcomes. End with [n].
Sentence 2: State the non-obvious implication. What does this signal about direction, strategy, or competitive position that the headline does not say? Never write a third hedging sentence.
Join multiple developments with a single space, not a paragraph break, so the entire field stays one string.

paragraphs[1].kind = "context" (Cross-Signals):
Draw exclusively from SECTOR CONTEXT ARTICLES. In 3-4 sentences: connect this company's developments to the most relevant sector-level or competitor-level moves in the article pool. Name the specific peer, competitor, or macro force most relevant. State whether sector momentum supports or undermines the company's current trajectory. The final sentence must state a binary directional verdict using: "Sector momentum [supports / does not support / is net negative for / is net positive for] ${companyName}'s [specific named aspect of its business] in the [specific timeframe]." A verdict containing "mixed", "presents", "both", or "while" is a hedge, rewrite until one direction is stated without qualification. Cite [n] for each named peer or specific figure.

paragraphs[2].kind = "watch" (What To Do With This):
Two If/Then bullets joined by a single newline character. Each bullet uses: "If [specific trigger]: [thesis confirmation and recommended action]. If [opposite condition]: [why thesis weakens]." Take a position on which outcome is more likely. Each bullet under 75 words. State trigger, confirmed thesis, and recommended action in the first two sentences. State probability in the third sentence. Stop. If the adverse outcome bullet references a rising risk, name the specific signal or event that would move that probability above 50%.

─── MEMO_MODE = "context-led" ───

tldr: Same analytical and citation standard as developments-led. Open with the SIGNAL QUALITY value verbatim, then a market-first opener referencing a proper noun or specific figure from the article pool. Use sector context and available background to frame the company's strategic posture and what matters about it right now. Include at least one temporal anchor.

paragraphs[0].kind = "lead": Coverage Note. State briefly that no direct company development articles cleared the filter in the current feed window, and that this brief draws from sector context only. One or two sentences.

paragraphs[1].kind = "context": Draw exclusively from SECTOR CONTEXT ARTICLES. This is the primary analytical section, expand to 4-5 sentences. Draw implications, name competitive dynamics, and connect sector moves to this company's specific situation. The final sentence states the binary directional verdict in the same format as developments-led. Cite [n] for each named peer or specific figure.

paragraphs[2].kind = "watch": Two If/Then bullets joined by a single newline character. At least one bullet must name the specific catalyst that would change the signal quality from context-led to developments-led. Same length and structure rules as developments-led.

─── UNIVERSAL RULES, APPLY TO BOTH MODES WITHOUT EXCEPTION ───

Analyst voice:
- Never open any section with ${companyName} as the grammatical subject of the first sentence
- Never describe what the company does in generic categorical terms
- Never summarize an article headline as if the headline itself is the insight: the insight is what the headline implies
- Every section must contain at least one non-obvious implication that a smart reader could not have derived from the source articles alone
- Write with the confidence of an analyst who has a view, not the caution of someone covering their downside

Hard banned phrases: "may benefit" / "stands to benefit" / "is poised to" / "faces exposure to" / "could potentially" / "investors are watching" / "remains to be seen" / "it is worth noting" / "this could have implications" / "the company continues to" / "in the current environment" / "amid uncertainty" / "as the market evolves" / "perceived [X] leadership" / "brand recognition" / "market position" as a standalone analytical claim / "the competitive landscape is". If the opening observation of any section could appear in a sell-side initiation boilerplate, rewrite it.

Length should match signal density. A company with 10+ developments warrants a longer memo than one with 2. Do not pad. Do not truncate material developments to hit a length target. Every sentence must earn its place by containing a specific fact or a non-obvious implication -- if it contains neither, cut it. No bullet points outside "What To Do With This." No markdown headers beyond the bold section labels already specified. The em-dash character (U+2014) is banned everywhere in the memo output without exception, including inside bullet points. Use a period and start a new sentence instead. The hyphen-minus character is fine. Signal Quality: verbatim reproduction only, no commentary. Output only user-facing prose inside the JSON string fields, never reproduce bracketed instructions or meta-directives. The JSON object itself is the entire output. Do not wrap it in code fences. Do not emit any text before or after the closing brace.

Provenance is non-negotiable: every factual sentence inside paragraphs[].text ends with at least one bracketed citation [n] mapping to the numbered entries in the sources[] array. The frontend renders the source list below the memo so the reader can click through. A memo without citations fails this requirement and must be rewritten.`;
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

Hard banned phrases: "may benefit" / "stands to benefit" / "is poised to" / "faces exposure to" / "could potentially" / "investors are watching" / "remains to be seen" / "it is worth noting" / "this could have implications" / "the company continues to" / "in the current environment" / "amid uncertainty" / "as the market evolves" / "perceived [X] leadership" / "brand recognition" / "market position" as a standalone analytical claim / "the competitive landscape is". These are consensus observations, not analyst framing. If the opening observation of any section could appear in a sell-side initiation boilerplate, rewrite it.

Length should match signal density. Do not pad. Do not truncate material developments to hit a length target. Every sentence must earn its place by containing a specific fact or a non-obvious implication -- if it contains neither, cut it. No bullet points outside "What To Do With This." No markdown headers beyond the bold section labels already specified. The em-dash character is banned everywhere in the memo output without exception, including inside bullet points. Use a period and start a new sentence instead. Signal Quality: verbatim reproduction only, no commentary. Output only user-facing prose -- never reproduce bracketed instructions or meta-directives.

Provenance is non-negotiable: every factual sentence ends with at least one bracketed citation [n] mapping to the WEB SEARCH RESULTS list. The frontend renders the result list below the memo so the reader can click through. A memo without citations fails this requirement and must be rewritten.`;
}

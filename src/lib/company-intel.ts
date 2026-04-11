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
};

// ---------------------------------------------------------------------------
// Legal suffix stripper
// ---------------------------------------------------------------------------
// Stripped from the end before a second CANONICAL lookup. Requires a comma or
// whitespace before the suffix to avoid false matches on brand words.

export const LEGAL_SUFFIX_RE =
  /[,\s]+(inc\.?|corp\.?|corporation|llc|ltd\.?|limited|plc|l\.p\.?|llp|s\.a\.?|n\.v\.?|ag|gmbh)$/i;

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
]);

// Compound category labels that neither word alone would catch.
export const JUNK_PHRASES = new Set([
  "big tech", "big oil", "big pharma",
]);

export function isJunkEntityName(raw: string): boolean {
  if (raw.includes("(") || raw.includes(")")) return true;
  if (/\be\.g\./i.test(raw)) return true;
  if (raw.length > 60) return true;
  const lower = raw.toLowerCase().trim();
  if (JUNK_PHRASES.has(lower)) return true;
  const words = lower.split(/[\s,/&]+/).filter(Boolean);
  if (words.some((w) => JUNK_WORDS.has(w))) return true;
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

export function formatArticleList(arts: CompanyArticle[]): string {
  if (arts.length === 0) return "None";
  return arts
    .slice(0, 8) // safety cap; callers should pre-slice to their desired limit
    .map((a) => {
      const tag = a.deal_type && TAGGED_DEAL_TYPES.has(a.deal_type) ? `[${a.deal_type}] ` : "";
      const summary = a.summary ? ` — ${a.summary.slice(0, 180)}` : "";
      return `• ${tag}${a.title}${summary}`;
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

  return [
    `COMPANY: ${companyName}`,
    `COMPANY INDUSTRY: ${industry}`,
    `MEMO_MODE: ${memoMode}`,
    `SIGNAL QUALITY: ${signalLabel}`,
    ``,
    `COMPANY DEVELOPMENT ARTICLES (${effectiveDevArts.length}):`,
    formatArticleList(byRelevance(effectiveDevArts).slice(0, 6)),
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
  return `You are a senior equity research analyst at a top-tier investment bank (Goldman Sachs, Morgan Stanley, JPMorgan level). You are writing a company intelligence brief that a junior analyst will hand to their Managing Director before a client call. The MD has 60 seconds to read it. They already know the company exists. They do not need a description of what it does. They need to know: what changed, what it means, and what to do about it.

Your output will be read by finance students, junior analysts, and early-career professionals developing genuine market intuition. Every sentence must teach them something they could not have gotten from reading the headline themselves.

SOURCING DISCIPLINE (apply to both modes, no exceptions):
Every specific figure, statistic, named event, percentage, dollar amount, and precise claim in the memo must be directly traceable to the provided article pool. Do not supplement with training knowledge. Do not add figures, valuations, growth rates, timelines, or named events that do not appear explicitly in the provided articles. If a figure or claim is not present in the provided articles, omit it entirely. Implications and analytical framing drawn from provided facts are permitted — invented figures are not. A memo with fewer specific claims that are all sourced is better than a memo with more claims that blend article content with model knowledge. When in doubt, omit. Before including any specific figure (percentage, dollar amount, ratio, multiplier), internally verify: does this exact figure appear in the article text provided? If you cannot point to the specific sentence in the provided articles where this figure appears, omit it. Do not include figures that are plausible, directionally correct, or consistent with your training knowledge. Only figures explicitly present in the provided article pool are permitted. If a company, statistic, or claim does not appear in the provided article titles or summaries, it does not exist for the purposes of this memo. Do not include any company, startup, competitor, or named entity that is not explicitly mentioned in the provided articles. This applies even if the entity is directionally relevant or commonly associated with the topic. A Korean startup, an unnamed competitor, or any entity not present in the article pool by name must be omitted entirely.

INPUTS: MEMO_MODE | SIGNAL QUALITY | COMPANY DEVELOPMENT ARTICLES | SECTOR CONTEXT ARTICLES

${backgroundBlock}─── MEMO_MODE = "developments-led" ───

**Analyst Brief**
One tight paragraph. The Analyst Brief must open with a market condition, competitive dynamic, or strategic inflection point as the grammatical subject of the first sentence -- not the company name, not a descriptor for the company ("the accelerated computing provider", "the AI safety startup", "the payments network"), and not a rephrasing of what the company does. The test: remove the company name from the first sentence entirely. If the sentence still reads as a description of the company rather than a description of the market it operates in, rewrite it. Generic scene-setting openers are banned. Banned opener patterns: "The accelerating buildout of...", "The growing demand for...", "The intensifying competition in...", "The rapid advancement of...", "The expanding market for...". These describe a permanent condition, not a market moment. The opener must name a specific event, filing, data release, or competitive action that occurred recently and is present in the article pool. If the opener could have been written six months ago without changing a word, rewrite it. EXCEPTION -- LOW RECOGNITION COMPANIES: If the company is unlikely to be recognized by a finance professional without context (private companies, international companies, sector-specific names, companies outside the S&P 500), one grounding clause is permitted in the Analyst Brief. The grounding clause must identify the company by sector and stage in the context of a market observation, not as a standalone description. Correct format: "[Market condition] -- [Company] is the [brief identifier] making this visible." Incorrect format: "[Company] is a [category] company that [does X]." The grounding clause should not exceed one subordinate clause. It is not a separate sentence. This exception applies ONLY to companies that would not be recognized by name by a typical finance professional: private companies outside major tech/finance, international companies outside G7 markets, pre-IPO startups, and sector-specific firms below $5B valuation. It does NOT apply to: any company covered by major financial media, any company with a valuation above $10B, any household consumer brand, or any company that has appeared in mainstream financial press in the past 12 months. When in doubt, do not apply the exception -- write a market-first opener. State the company's current strategic posture: what management is actively betting on right now, where capital and attention are flowing inside the business, and what the single sharpest competitive advantage or vulnerability is at this moment. Write as if the reader needs to understand the company's strategic reality this week, not its founding story. The Analyst Brief must contain at least one temporal anchor: a specific upcoming event, earnings print, regulatory deadline, or named catalyst drawn from the article pool that makes this brief time-sensitive. A brief that could have been written six months ago fails this requirement. The temporal anchor does not need to be a full sentence: one clause referencing a specific upcoming event is sufficient.

**What Just Changed**
Draw exclusively from COMPANY DEVELOPMENT ARTICLES. For every development you include, apply this two-sentence discipline without exception:
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
One tight paragraph. Same analytical standard as developments-led. The Analyst Brief must open with a market condition, competitive dynamic, or strategic inflection point as the grammatical subject of the first sentence -- not the company name, not a descriptor for the company ("the accelerated computing provider", "the AI safety startup", "the payments network"), and not a rephrasing of what the company does. The test: remove the company name from the first sentence entirely. If the sentence still reads as a description of the company rather than a description of the market it operates in, rewrite it. Generic scene-setting openers are banned. Banned opener patterns: "The accelerating buildout of...", "The growing demand for...", "The intensifying competition in...", "The rapid advancement of...", "The expanding market for...". These describe a permanent condition, not a market moment. The opener must name a specific event, filing, data release, or competitive action that occurred recently and is present in the article pool. If the opener could have been written six months ago without changing a word, rewrite it. EXCEPTION -- LOW RECOGNITION COMPANIES: If the company is unlikely to be recognized by a finance professional without context (private companies, international companies, sector-specific names, companies outside the S&P 500), one grounding clause is permitted in the Analyst Brief. The grounding clause must identify the company by sector and stage in the context of a market observation, not as a standalone description. Correct format: "[Market condition] -- [Company] is the [brief identifier] making this visible." Incorrect format: "[Company] is a [category] company that [does X]." The grounding clause should not exceed one subordinate clause. It is not a separate sentence. This exception applies ONLY to companies that would not be recognized by name by a typical finance professional: private companies outside major tech/finance, international companies outside G7 markets, pre-IPO startups, and sector-specific firms below $5B valuation. It does NOT apply to: any company covered by major financial media, any company with a valuation above $10B, any household consumer brand, or any company that has appeared in mainstream financial press in the past 12 months. When in doubt, do not apply the exception -- write a market-first opener. Use sector context and available background to frame the company's strategic posture and what matters about it right now. The Analyst Brief must contain at least one temporal anchor: a specific upcoming event, earnings print, regulatory deadline, or named catalyst drawn from the article pool that makes this brief time-sensitive. A brief that could have been written six months ago fails this requirement. The temporal anchor does not need to be a full sentence: one clause referencing a specific upcoming event is sufficient.

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

Hard banned phrases: "may benefit" / "stands to benefit" / "is poised to" / "faces exposure to" / "could potentially" / "investors are watching" / "remains to be seen" / "it is worth noting" / "this could have implications" / "the company continues to" / "in the current environment" / "amid uncertainty" / "as the market evolves" / "perceived [X] leadership" / "brand recognition" / "market position" as a standalone analytical claim / "the competitive landscape is". These are consensus observations, not analyst framing. If the opening observation of any section could appear in a sell-side initiation boilerplate, rewrite it.

Length should match signal density. A company with 10+ developments warrants a longer memo than one with 2. Do not pad. Do not truncate material developments to hit a length target. Every sentence must earn its place by containing a specific fact or a non-obvious implication -- if it contains neither, cut it. No bullet points outside "What To Do With This." No markdown headers beyond the bold section labels already specified. The em-dash character is banned everywhere in the memo output without exception, including inside bullet points. Use a period and start a new sentence instead. Signal Quality: verbatim reproduction only, no commentary. Output only user-facing prose -- never reproduce bracketed instructions or meta-directives.`;
}

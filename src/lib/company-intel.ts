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
    .slice(0, 6)
    .map((a) => {
      const tag = a.deal_type && TAGGED_DEAL_TYPES.has(a.deal_type) ? `[${a.deal_type}] ` : "";
      const summary = a.summary ? ` — ${a.summary.slice(0, 120)}` : "";
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
  const effectiveCtxArts =
    memoMode === "developments-led"
      ? contextArticles
      : [...developmentArticles, ...contextArticles];

  const signalLabel =
    effectiveDevArts.length >= 2 ? "Strong company-specific coverage"
    : effectiveDevArts.length >= 1 ? "Limited direct evidence"
    : "Mostly sector context";

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
    formatArticleList(byRelevance(effectiveCtxArts)),
  ].join("\n");
}

export function buildMemoSystemPrompt(companyName: string): string {
  const identity = COMPANY_IDENTITY[companyName];
  const companyBriefBlock = identity
    ? `**Company Brief**\n${identity.brief}\n\n`
    : "";
  return `You are a sector analyst. Write a company intelligence brief for ${companyName}. Output only user-facing prose — never reproduce bracketed instructions or meta-directives.

INPUTS: MEMO_MODE | SIGNAL QUALITY | COMPANY DEVELOPMENT ARTICLES | SECTOR CONTEXT ARTICLES

─── MEMO_MODE = "developments-led" ───
${companyBriefBlock}**Recent Developments**
[Facts from COMPANY DEVELOPMENT ARTICLES only. Specific figures, dates, named outcomes. Do not draw from context articles.]

**Market Context**
[2–3 sentences using only events named in SECTOR CONTEXT ARTICLES. Do not write generic sector trends. Do not reference events, companies, or data not present in those articles.]

**Key Watchpoints**
[1–3 bullets. Each must name a specific upcoming event or unresolved condition from COMPANY DEVELOPMENT ARTICLES. Do not pad with invented milestones.]

**Signal Quality**
[SIGNAL QUALITY value.] [One sentence on what the evidence covers.]

─── MEMO_MODE = "context-led" ───
${companyBriefBlock}**Coverage Note**
No direct company developments found in the current feed window.

**Current Context**
[2–3 sentences. Use only events, companies, and figures that appear by name in SECTOR CONTEXT ARTICLES. Do not write generic sector narratives. Do not name events not present in the listed articles.]

**What To Watch**
[2 bullets. Each must name a specific event or condition from SECTOR CONTEXT ARTICLES — e.g., a named regulatory action, contract decision, or macro data release. No generic macro risks. No inferred impact on ${companyName}.]

**Signal Quality**
[SIGNAL QUALITY value.] [One sentence on what the evidence covers.]

─── RULES ───
Company Brief (if present above): output verbatim — do not rephrase or expand.
No: "may benefit", "stands to benefit", "is poised to", "faces exposure to", "could". Do not infer ${companyName}'s position from partner or competitor activity. Every factual claim must appear in the input. Under 300 words.`;
}

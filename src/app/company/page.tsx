"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Search, Building2, Bookmark, Sparkles, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { createBrowserClient } from "@supabase/ssr";
import { getSectorStyle } from "@/lib/sector-colors";
import { MemoModal } from "@/components/memo/MemoModal";

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

interface CompanyData {
  name: string;
  mentions: number;
  sectors: string[];
}

interface CompanyArticle {
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
  // True when the article describes a company-specific event (earnings, funding, M&A, IPO,
  // contract award, product launch). Distinct from "company is primary subject" — a geopolitical
  // story where NVIDIA is the primary subject is NOT a development.
  _isDevelopment: boolean;
}

// Canonical name map — keys are lowercase variants, value is preferred display name.
// Keys must be lowercase. Handles renames (google→Alphabet), short forms (goldman→Goldman Sachs),
// and legal-suffix variants resolved after suffix stripping (see canonicalize below).
const CANONICAL: Record<string, string> = {
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
  // Goldman Sachs — "goldman" alone in article data = Goldman Sachs
  "goldman sachs": "Goldman Sachs",
  "goldman sachs group": "Goldman Sachs",
  "the goldman sachs group": "Goldman Sachs",
  goldman: "Goldman Sachs",
  // Berkshire Hathaway
  "berkshire hathaway": "Berkshire Hathaway",
  "berkshire hathaway inc": "Berkshire Hathaway",
  // Marvell — ingest produces "Marvell", "Marvell Technology", "Marvell Technology Inc."
  marvell: "Marvell Technology",
  "marvell technology": "Marvell Technology",
  // Lockheed Martin — "Lockheed" alone in article data = Lockheed Martin
  lockheed: "Lockheed Martin",
  "lockheed martin": "Lockheed Martin",
  "lockheed martin corporation": "Lockheed Martin",
  // Whoop — ingest produces both "Whoop" and "WHOOP"
  whoop: "Whoop",
  // Arm Holdings — ingest produces "Arm" and "Arm Holdings"
  arm: "Arm Holdings",
  "arm holdings": "Arm Holdings",
  // Samsung — ingest produces "Samsung" and "Samsung Electronics"
  "samsung electronics": "Samsung",
  "samsung electronics co": "Samsung",
  // SoftBank — ingest produces "SoftBank" and "SoftBank Group"
  softbank: "SoftBank",
  "softbank group": "SoftBank",
  // Foxconn / Hon Hai — same company, different names in different articles
  foxconn: "Foxconn",
  "hon hai": "Foxconn",
  "hon hai precision": "Foxconn",
  "hon hai precision industry": "Foxconn",
};

// Legal entity suffixes that are never part of a company's identity.
// Stripped from the end before a second CANONICAL lookup (see canonicalize).
// Requires a comma or whitespace before the suffix to avoid false matches on
// brand words — "SomeCorp" does not match, "Some Corp" does.
const LEGAL_SUFFIX_RE =
  /[,\s]+(inc\.?|corp\.?|corporation|llc|ltd\.?|limited|plc|l\.p\.?|llp|s\.a\.?|n\.v\.?|ag|gmbh)$/i;

// Company identity map — curated, bounded descriptions of what each company IS and DOES.
// `industry` is used as a content-type label in memoContent.
// `brief` is injected verbatim into the Company Brief section — no model generation.
// Only include companies where we can state the description with confidence.
// Unmapped companies get no Company Brief section.
interface CompanyIdentity { industry: string; brief: string; }
const COMPANY_IDENTITY: Record<string, CompanyIdentity> = {
  // Semiconductors & Hardware
  "NVIDIA":           { industry: "Semiconductors",        brief: "NVIDIA designs GPUs and accelerated computing platforms used in AI training, data center infrastructure, gaming, and professional visualization." },
  "Intel":            { industry: "Semiconductors",        brief: "Intel designs and manufactures CPUs, GPUs, and networking chips for computing, data center, and AI workloads." },
  "Marvell Technology": { industry: "Semiconductors",      brief: "Marvell Technology designs custom ASICs and networking semiconductors for data centers, 5G carriers, and enterprise storage, with a strategic focus on AI networking and cloud infrastructure acceleration." },
  // Consumer & Enterprise Technology
  "Apple":            { industry: "Consumer Technology",   brief: "Apple designs consumer electronics, software, and services — including iPhone, Mac, and iPad — anchored by its tightly integrated hardware-software ecosystem." },
  "Microsoft":        { industry: "Technology",            brief: "Microsoft develops operating systems, enterprise software, and cloud infrastructure (Azure), serving enterprise and consumer markets globally." },
  "Alphabet":         { industry: "Technology",            brief: "Alphabet operates Google Search, YouTube, and Google Cloud; it generates revenue primarily from digital advertising and cloud services." },
  "Meta":             { industry: "Technology",            brief: "Meta operates Facebook, Instagram, and WhatsApp, generating revenue primarily from digital advertising across its family of social apps." },
  "Amazon":           { industry: "Technology / E-Commerce", brief: "Amazon operates the world's largest e-commerce marketplace and cloud infrastructure platform (AWS), with additional businesses in logistics, advertising, and streaming." },
  "Tesla":            { industry: "Electric Vehicles",     brief: "Tesla designs and manufactures electric vehicles, energy storage systems, and solar products, and develops autonomous driving software." },
  "Salesforce":       { industry: "Enterprise Software",   brief: "Salesforce provides cloud-based CRM software and enterprise applications for sales, service, marketing, and commerce teams." },
  "Oracle":           { industry: "Enterprise Technology", brief: "Oracle provides enterprise database software, cloud infrastructure, and ERP applications primarily to large enterprises and governments." },
  "Palantir":         { industry: "Data Analytics",        brief: "Palantir develops AI-powered data analytics platforms for government intelligence agencies and large enterprises." },
  "IBM":              { industry: "Technology",            brief: "IBM provides hybrid cloud infrastructure, AI software, and IT services primarily to large enterprises and government customers." },
  // Artificial Intelligence
  "OpenAI":           { industry: "Artificial Intelligence", brief: "OpenAI develops large language models and AI systems — including GPT-4 and ChatGPT — offered via API and consumer products." },
  "Anthropic":        { industry: "Artificial Intelligence", brief: "Anthropic develops AI safety-focused large language models and AI systems, including the Claude family of models." },
  // Aerospace & Defense
  "Lockheed Martin":  { industry: "Aerospace & Defense",   brief: "Lockheed Martin is an aerospace and defense contractor that develops military aircraft, missile systems, space systems, and defense electronics for the U.S. military and allied governments." },
  "Boeing":           { industry: "Aerospace & Defense",   brief: "Boeing manufactures commercial jetliners, military aircraft, and space systems, and provides defense and aerospace services to government and commercial customers." },
  "Raytheon":         { industry: "Aerospace & Defense",   brief: "Raytheon develops missile systems, radar, sensors, and defense electronics for the U.S. military and allied governments." },
  "Northrop Grumman": { industry: "Aerospace & Defense",   brief: "Northrop Grumman develops stealth aircraft, space systems, missile defense, and cybersecurity solutions for U.S. and allied defense programs." },
  "SpaceX":           { industry: "Aerospace",             brief: "SpaceX develops reusable rockets and spacecraft for satellite deployment, cargo resupply, and crewed missions to the International Space Station." },
  "General Dynamics": { industry: "Aerospace & Defense",   brief: "General Dynamics manufactures military vehicles, submarines, combat systems, and provides IT services to government customers." },
  // Financial Services
  "JPMorgan Chase":   { industry: "Financial Services",    brief: "JPMorgan Chase is the largest U.S. bank by assets, providing investment banking, commercial banking, financial services, and asset management." },
  "Goldman Sachs":    { industry: "Investment Banking",    brief: "Goldman Sachs provides investment banking, securities trading, asset management, and financial advisory services to institutional and corporate clients globally." },
  "Morgan Stanley":   { industry: "Investment Banking",    brief: "Morgan Stanley provides investment banking, institutional securities, and wealth management services to governments, corporations, and high-net-worth clients." },
  "Bank of America":  { industry: "Financial Services",    brief: "Bank of America provides consumer banking, global markets, investment banking, and wealth management services across the U.S. and internationally." },
  "Berkshire Hathaway": { industry: "Diversified Financials", brief: "Berkshire Hathaway is a diversified holding company with wholly owned businesses across insurance, railroads, utilities, manufacturing, and financial services." },
  "BlackRock":        { industry: "Asset Management",      brief: "BlackRock is the world's largest asset manager, providing investment management, risk advisory, and financial technology services to institutional and retail investors." },
  "Visa":             { industry: "Financial Technology",  brief: "Visa operates a global digital payments network connecting consumers, merchants, and financial institutions across more than 200 countries." },
  "Mastercard":       { industry: "Financial Technology",  brief: "Mastercard operates a global payment processing network and provides digital commerce technology to banks, merchants, and governments." },
  // Healthcare & Pharma
  "Pfizer":           { industry: "Pharmaceuticals",       brief: "Pfizer discovers, develops, and manufactures pharmaceutical drugs and vaccines across oncology, immunology, cardiology, and infectious disease." },
  "Johnson & Johnson": { industry: "Healthcare",           brief: "Johnson & Johnson develops pharmaceuticals, medical devices, and consumer health products across a broad range of therapeutic areas." },
  // Energy & Consumer
  "ExxonMobil":       { industry: "Energy",                brief: "ExxonMobil explores for, produces, refines, and markets petroleum products, natural gas, and petrochemicals globally." },
  "Chevron":          { industry: "Energy",                brief: "Chevron explores for, produces, and refines petroleum and natural gas, and is expanding into lower-carbon energy businesses." },
  "Walmart":          { industry: "Consumer Retail",       brief: "Walmart operates the world's largest retail network of physical stores and e-commerce, targeting everyday low prices for mass-market consumers." },
};

function canonicalize(name: string): string {
  const trimmed = name.trim().replace(/[.,]$/g, "");
  const key = trimmed.toLowerCase();

  // Pass 1: direct CANONICAL lookup — handles explicit aliases and renames
  if (CANONICAL[key]) return CANONICAL[key];

  // Pass 2: strip one legal suffix, retry CANONICAL lookup.
  // "Marvell Technology Inc." → "Marvell Technology" → CANONICAL hit.
  // "Goldman Sachs Group Inc." → "Goldman Sachs Group" → CANONICAL hit.
  const stripped = trimmed.replace(LEGAL_SUFFIX_RE, "").trim();
  if (stripped.length >= 4 && stripped !== trimmed) {
    const strippedKey = stripped.toLowerCase();
    if (CANONICAL[strippedKey]) return CANONICAL[strippedKey];
    // No CANONICAL hit after stripping — return the suffix-stripped form as display.
    // e.g. "Acme Corp." → "Acme" rather than "Acme Corp."
    return stripped;
  }

  // Pass 3: fallback — return original trimmed form (original casing preserved)
  return trimmed;
}

function parseCompanies(cos: unknown): string[] {
  if (!cos) return [];
  if (typeof cos === "string") {
    try { return JSON.parse(cos); } catch { return []; }
  }
  return Array.isArray(cos) ? cos : [];
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// Returns true if rawName (from the primary_company DB field) resolves to canonicalName
// using the same canonicalize + prefix logic as article-company matching.
function matchesCanonical(rawName: string, canonicalName: string): boolean {
  const rawCanon = canonicalize(rawName).toLowerCase();
  const targetLower = canonicalName.toLowerCase();
  if (rawCanon === targetLower) return true;
  if (targetLower.length >= 5 && rawCanon.startsWith(targetLower)) return true;
  if (rawCanon.length >= 5 && targetLower.startsWith(rawCanon)) return true;
  return false;
}

// Returns true if companyName is the grammatical subject of the headline — i.e., the
// company appears at the very start of the title, followed by a word boundary.
//
// Used as a fallback actor signal for Funding/IPO articles where primary_company is null.
// News headlines about a company's own funding round lead with the company:
//   "Whoop raises $575M Series G"         → Whoop is subject → true
//   "WHOOP valued at $10B"                → WHOOP is subject → true
// Competitor / comparison / context mentions do not lead with the selected company:
//   "Fractile seeks $200M to challenge NVIDIA" → starts with "Fractile" → false for NVIDIA
//   "Mistral secures $830M to house NVIDIA chips" → starts with "Mistral" → false for NVIDIA
//   "NVIDIA-backed startup raises $50M"        → "NVIDIA-" has no space after → false for NVIDIA
//
// Word-boundary check: require space, apostrophe, or comma immediately after company name
// to avoid matching "NVIDIA-backed" or "NVIDIAx" as if NVIDIA were the subject.
function isSubjectOfTitle(title: string, companyName: string): boolean {
  const t = title.toLowerCase().trim();
  const cn = companyName.toLowerCase();
  // Strip common editorial prefixes so "Report: Whoop raises..." still matches
  const stripped = t.replace(/^(report|breaking|exclusive|sources?|scoop|update|analysis)[:\s]+["']?/, "").trimStart();
  return (
    stripped.startsWith(cn + " ") ||   // "whoop raises..."
    stripped.startsWith(cn + "'") ||   // "whoop's valuation..."
    stripped.startsWith(cn + ",")      // "whoop, the startup,..."
  );
}

// Returns true if the selected company is explicitly named anywhere in the article title —
// not just as the grammatical subject. Handles short-form raw values: e.g. "Marvell" appears
// in the title of "Nvidia Invests $2 Billion in Marvell" even though the canonical display
// name is "Marvell Technology" and the DB raw value is "Marvell Technology Inc."
//
// Strategy:
//   1. Canonical display name substring check (e.g. "marvell technology" in title)
//   2. For each raw companies[] value that resolves to this company:
//      a. Full normalized raw form in title (e.g. "marvell technology inc.")
//      b. First word of raw form, min 6 chars (e.g. "marvell" from "Marvell Technology Inc.")
//
// The 6-char minimum on the first-word fallback prevents accidental matches on short generic
// words like "bank", "tech", "group". Companies with short names (Meta=4, Intel=5) are
// handled by the direct raw-form check (step 2a, requires ≥ 5 chars).
function titleNamesCompany(title: string, cosRaw: string[], name: string): boolean {
  const t = title.toLowerCase();
  const nameLower = name.toLowerCase();

  // 1. Canonical display name in title
  if (nameLower.length >= 5 && t.includes(nameLower)) return true;

  // 2. Each raw companies[] value that resolves to this company
  for (const raw of cosRaw) {
    const cCanon = canonicalize(raw).toLowerCase();
    const isOurCompany =
      cCanon === nameLower ||
      (nameLower.length >= 5 && cCanon.startsWith(nameLower)) ||
      (cCanon.length >= 5 && nameLower.startsWith(cCanon));
    if (!isOurCompany) continue;

    const rawNorm = raw.trim().replace(/[.,]$/g, "").toLowerCase();
    // 2a. Full raw form
    if (rawNorm.length >= 5 && t.includes(rawNorm)) return true;
    // 2b. First word of raw form — "Marvell Technology Inc." → "marvell" found in title
    const firstWord = rawNorm.split(/\s+/)[0];
    if (firstWord.length >= 6 && t.includes(firstWord)) return true;
  }
  return false;
}

// An article is a development when the company is the ACTOR, not merely a subject or
// named example. These deal types reliably indicate a company-specific event:
//   Earnings  — reported results
//   M&A       — acquiring, merging, or being acquired
//   Funding   — raising capital (qualifies even with co-mentioned investors)
//   IPO       — going public
// "Other" is excluded. It is a junk-drawer tag at ingest that covers both genuine
// company announcements AND regulatory/enforcement/analyst stories where the company
// is a subject but not the actor. Stage 1 favors precision — borderline misses are
// acceptable; development bucket contamination is not.
const DEVELOPMENT_DEAL_TYPES = new Set(["Earnings", "M&A", "Funding", "IPO"]);

// Tags surfaced in memo evidence so the model can read event type without inferring from prose.
const TAGGED_DEAL_TYPES = new Set(["Earnings", "M&A", "Funding", "IPO", "Macro", "Geopolitical", "Other"]);

function formatArticleList(arts: CompanyArticle[]): string {
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

export default function CompanyIntelPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [companies, setCompanies] = useState<CompanyData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCompany, setSelectedCompany] = useState<CompanyData | null>(null);
  const [companyArticles, setCompanyArticles] = useState<CompanyArticle[]>([]);
  const [articlesLoading, setArticlesLoading] = useState(false);
  const [memoOpen, setMemoOpen] = useState(false);
  const [memoToast, setMemoToast] = useState("");

  // Build company list from article mentions
  useEffect(() => {
    async function load() {
      try {
        const { data: articles, error: articlesErr } = await getSupabase()
          .from("articles")
          .select("companies, sector")
          .order("ingested_at", { ascending: false })
          .limit(1500);

        if (articlesErr) {
          console.error("Company intel query error:", articlesErr.message);
          return;
        }
        if (!articles) return;

        // Key by display.toLowerCase() so that case variants of the same name
        // ("Whoop" and "WHOOP", for example) group into one row. canonicalize()
        // resolves CANONICAL aliases and strips legal suffixes before this point,
        // so "Marvell Technology Inc." and "Marvell" both produce display
        // "Marvell Technology" and key "marvell technology".
        //
        // When the same key is seen with different casings (neither form in CANONICAL),
        // prefer a mixed-case display form over an ALL-CAPS form.
        const compMap: Record<string, { display: string; mentions: number; sectors: Set<string> }> = {};
        articles.forEach((a) => {
          const cos = parseCompanies(a.companies);
          cos.forEach((raw) => {
            if (!raw || raw.length < 2) return;
            const display = canonicalize(raw);
            const key = display.toLowerCase();
            if (!compMap[key]) {
              compMap[key] = { display, mentions: 0, sectors: new Set() };
            } else if (/[a-z]/.test(display) && !/[a-z]/.test(compMap[key].display)) {
              // Upgrade from ALL-CAPS to mixed-case display form when available
              compMap[key].display = display;
            }
            compMap[key].mentions++;
            if (a.sector) compMap[key].sectors.add(a.sector);
          });
        });

        const list = Object.entries(compMap)
          .map(([, data]) => ({
            name: data.display,
            mentions: data.mentions,
            sectors: Array.from(data.sectors),
          }))
          .sort((a, b) => b.mentions - a.mentions);

        setCompanies(list);
      } catch (e) {
        console.error("Failed to build company list:", e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Filter companies by search
  const filtered = useMemo(() => {
    if (!search.trim()) return companies;
    const q = search.toLowerCase();
    return companies.filter((c) => c.name.toLowerCase().includes(q));
  }, [companies, search]);

  // Development articles: company-specific events (earnings, funding, M&A, IPO, named announcements).
  // Context articles: everything else — macro, geopolitical, sector analysis, competitive mentions.
  const developmentArticles = useMemo(
    () => companyArticles.filter((a) => a._isDevelopment),
    [companyArticles],
  );
  const contextArticles = useMemo(
    () => companyArticles.filter((a) => !a._isDevelopment),
    [companyArticles],
  );

  // Memo content — model receives explicitly categorized evidence, not a flat article list.
  // COMPANY INDUSTRY: stable identity (what the company IS).
  // SIGNAL QUALITY: computed from development article count — never delegated to the model.
  // COMPANY DEVELOPMENT ARTICLES: articles describing company-specific events only.
  // SECTOR CONTEXT ARTICLES: everything else mentioning the company.
  const memoContent = useMemo(() => {
    if (!selectedCompany) return "";
    const industry = COMPANY_IDENTITY[selectedCompany.name]?.industry ?? "Unknown";

    // Sort by relevance_score DESC, then published_at DESC as tie-breaker.
    // Highest-signal articles reach the model first, not just the most recently ingested.
    const byRelevance = (arts: CompanyArticle[]) =>
      [...arts].sort((a, b) => {
        const scoreDiff = (b.relevance_score ?? 5) - (a.relevance_score ?? 5);
        if (scoreDiff !== 0) return scoreDiff;
        const dateA = a.published_at ? new Date(a.published_at).getTime() : 0;
        const dateB = b.published_at ? new Date(b.published_at).getTime() : 0;
        return dateB - dateA;
      });

    // Signal quality computed from development article count — not guessed by the model.
    const signalLabel =
      developmentArticles.length >= 2 ? "Strong company-specific coverage"
      : developmentArticles.length >= 1 ? "Limited direct evidence"
      : "Mostly sector context";

    // MEMO_MODE tells the model which output structure to use.
    // developments-led: Recent Developments + Key Watchpoints grounded in company events.
    // context-led: Coverage Note + Current Context + What To Watch from sector articles only.
    const memoMode = developmentArticles.length > 0 ? "developments-led" : "context-led";

    return [
      `COMPANY: ${selectedCompany.name}`,
      `COMPANY INDUSTRY: ${industry}`,
      `MEMO_MODE: ${memoMode}`,
      `SIGNAL QUALITY: ${signalLabel}`,
      ``,
      `COMPANY DEVELOPMENT ARTICLES (${developmentArticles.length}):`,
      formatArticleList(byRelevance(developmentArticles)),
      ``,
      `SECTOR CONTEXT ARTICLES (${contextArticles.length}):`,
      formatArticleList(byRelevance(contextArticles)),
    ].join("\n");
  }, [selectedCompany, developmentArticles, contextArticles]);

  // Load articles when a company is selected
  useEffect(() => {
    if (!selectedCompany) return;
    setArticlesLoading(true);
    setCompanyArticles([]);

    async function loadArticles() {
      try {
        const name = selectedCompany!.name;
        // Fetch without sector scoping. The previous sector-scoped optimization silently
        // dropped valid articles: if a popular sector (e.g. Geopolitics & Macro) had > 500
        // articles total, the .limit(500) would return only the newest 500 in that sector,
        // missing older-but-still-valid articles for sparse companies like Lockheed Martin.
        // Correctness > performance here — filter client-side instead.
        const { data: articles, error: detailErr } = await getSupabase()
          .from("articles")
          .select("id, title, source, sector, sentiment, summary, published_at, ingested_at, url, companies, primary_company, relevance_score, deal_type")
          .order("ingested_at", { ascending: false })
          .limit(1500);

        if (detailErr) {
          console.error("Company articles query error:", detailErr.message);
          return;
        }
        if (articles) {
          const nameLower = name.toLowerCase();
          // Match articles whose companies[] contains this company (canonical + prefix variants).
          // e.g. "Lockheed Martin Corporation" resolves to "Lockheed Martin"
          const matched = articles.filter((a) => {
            const cos = parseCompanies(a.companies);
            return cos.some((c) => {
              const cCanon = canonicalize(c).toLowerCase();
              if (cCanon === nameLower) return true;
              // Prefix match (min 5 chars to avoid false positives like "Ford")
              if (nameLower.length >= 5 && cCanon.startsWith(nameLower)) return true;
              if (cCanon.length >= 5 && nameLower.startsWith(cCanon)) return true;
              return false;
            });
          });

          const mapped = matched.map((a) => {
            // Development = the SELECTED COMPANY was involved in a concrete, named event.
            //
            // STRICT path (Earnings, M&A with known actor):
            //   Require primary_company match. These event types have one clear actor.
            //   If ingest left primary_company null → fall through to material-counterparty check.
            //
            // FUNDING/IPO path — three-level actor test:
            //   Level 1: primary_company is set and matches → clear ingest signal → development
            //   Level 2: primary_company is null + company is headline subject → actor by title position
            //     "Whoop raises $575M"          → "whoop " at title start → development ✓
            //     "Fractile seeks $200M to challenge NVIDIA" → starts "fractile " → context for NVIDIA ✓
            //     "Mistral secured $830M to house NVIDIA chips" → starts "mistral " → context ✓
            //     "Korean startup backed by Samsung..." → starts "korean " → context ✓
            //   Level 3: primary_company is set to a DIFFERENT company → that company is the actor → context
            //
            // MATERIAL COUNTERPARTY path (M&A / Funding / IPO, primary_company null):
            //   Handles cases where the selected company is the named target/investee in a deal,
            //   not the actor. Primary_company left null by ingest for ambiguous multi-party deals.
            //   Guard: company must appear explicitly in the article title — not just companies[].
            //   This separates named counterparties from incidental sector mentions:
            //     "Nvidia Invests $2 Billion in Marvell" → "marvell" in title → development for Marvell ✓
            //     "Arms makers eye windfall as war drains stockpiles" → "lockheed" not in title → context ✓
            //
            // Everything else → context.
            const isStrictDevelopment =
              (a.deal_type === "Earnings" || a.deal_type === "M&A") &&
              a.primary_company != null &&
              matchesCanonical(a.primary_company, name);

            const isFundingOrIPO =
              (a.deal_type === "Funding" || a.deal_type === "IPO") &&
              (
                (a.primary_company != null && matchesCanonical(a.primary_company, name)) ||
                (a.primary_company == null && isSubjectOfTitle(a.title, name))
              );

            const isMaterialCounterparty =
              !isStrictDevelopment &&
              !isFundingOrIPO &&
              (a.deal_type === "M&A" || a.deal_type === "Funding" || a.deal_type === "IPO") &&
              a.primary_company == null &&
              titleNamesCompany(a.title, parseCompanies(a.companies), name);

            const isDevelopment = isStrictDevelopment || isFundingOrIPO || isMaterialCounterparty;

            return {
              id: a.id,
              title: a.title,
              source: a.source,
              sector: a.sector,
              sentiment: a.sentiment,
              summary: a.summary,
              published_at: a.published_at || a.ingested_at,
              url: a.url,
              primary_company: a.primary_company ?? null,
              relevance_score: typeof a.relevance_score === "number" ? a.relevance_score : undefined,
              deal_type: typeof a.deal_type === "string" ? a.deal_type : null,
              _isDevelopment: isDevelopment,
            };
          });

          setCompanyArticles(mapped);
        }
      } catch (e) {
        console.error("Failed to load company articles:", e);
      } finally {
        setArticlesLoading(false);
      }
    }
    loadArticles();
  }, [selectedCompany]);

  const handleAddToWatchlist = async (companyName: string) => {
    try {
      await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: companyName, type: "company" }),
      });
    } catch (e) {
      console.error("Failed to add to watchlist:", e);
    }
  };

  return (
    <AppShell pageTitle="Company Intel" mood="neutral" moodHeadline="Markets steady" moodDetails={["VIX 14.2", "S&P +0.38%"]}>
      <div className="flex h-[calc(100vh-var(--topbar-height)-var(--moodbar-height))]">
        {/* Main panel */}
        <div className={cn("flex-1 overflow-y-auto p-6", selectedCompany && "pr-0")}>
          <div className="max-w-[720px]">
            <h2 className="font-display text-[22px] font-extrabold text-espresso mb-1">
              Company Intel
            </h2>
            <p className="font-sans text-[13px] text-text-secondary mb-5">
              Companies extracted from {companies.length > 0 ? `${companies.length} article mentions` : "your news feed"}. Click any company to see related coverage.
            </p>

            {/* Search */}
            <div className="relative mb-6">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search companies..."
                className="pl-9 font-sans"
              />
            </div>

            {/* Company grid */}
            {loading ? (
              <div className="grid grid-cols-2 gap-2">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <Skeleton key={i} className="h-20 rounded-xl" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={<Building2 size={32} />}
                title={search ? "No companies match" : "No companies found"}
                description={search ? "Try a different search term" : "Companies will appear once articles are ingested"}
              />
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {filtered.slice(0, 40).map((company) => (
                  <button
                    key={company.name}
                    type="button"
                    onClick={() => setSelectedCompany(company)}
                    className={cn(
                      "flex flex-col items-start p-3 rounded-xl border bg-white text-left",
                      "transition-all duration-[var(--duration-base)] cursor-pointer",
                      selectedCompany?.name === company.name
                        ? "border-gold shadow-[0_2px_8px_rgba(201,146,42,0.12)]"
                        : "border-border-base hover:border-border-hover",
                    )}
                  >
                    <div className="flex items-center gap-2 mb-1 w-full">
                      <span className="font-display text-[14px] font-bold text-espresso truncate flex-1">
                        {company.name}
                      </span>
                      <span className="font-data text-[10px] text-gold bg-gold-muted border border-gold-border px-1.5 py-0.5 rounded-md flex-shrink-0">
                        {company.mentions}x
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Detail side panel */}
        {selectedCompany && (
          <div className="w-[420px] flex-shrink-0 border-l border-border-base bg-cream flex flex-col overflow-hidden">
            {/* Panel header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border-base flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <span className="font-display text-[18px] font-bold text-espresso">
                  {selectedCompany.name}
                </span>
                <span className="font-data text-[10px] text-gold bg-gold-muted border border-gold-border px-1.5 py-0.5 rounded-md">
                  {selectedCompany.mentions}x
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCompany(null)}
                className="font-sans text-[18px] text-text-muted hover:text-text-primary cursor-pointer p-1"
              >
                &times;
              </button>
            </div>

            {/* Panel body */}
            <div className="flex-1 overflow-y-auto px-5 py-4">

              {/* Actions */}
              <div className="flex items-center gap-2 mb-4">
                <button
                  type="button"
                  onClick={() => handleAddToWatchlist(selectedCompany.name)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-parchment-mid border border-border-base font-sans text-[11px] font-medium text-text-secondary hover:border-border-hover transition-colors cursor-pointer"
                >
                  <Bookmark size={11} />
                  Add to Watchlist
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      if (articlesLoading) return;
                      if (companyArticles.length === 0) {
                        setMemoToast("No articles found for this company — memo cannot be grounded");
                        setTimeout(() => setMemoToast(""), 3000);
                        return;
                      }
                      setMemoOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gold text-cream font-sans text-[11px] font-semibold hover:bg-gold-dark transition-colors cursor-pointer"
                  >
                    <Sparkles size={11} />
                    Generate Memo
                  </button>
                  {memoToast && (
                    <div className="absolute -top-9 left-0 whitespace-nowrap bg-espresso text-cream font-sans text-[10px] px-2.5 py-1.5 rounded-md z-10">
                      {memoToast}
                    </div>
                  )}
                </div>
              </div>

              {/* Articles header */}
              <p className="font-data text-[9px] uppercase tracking-widest text-gold font-semibold mb-3">
                Articles Mentioning {selectedCompany.name.toUpperCase()} ({companyArticles.length})
                {!articlesLoading && developmentArticles.length > 0 && (
                  <span className="ml-2 text-gold normal-case">
                    · {developmentArticles.length} development{developmentArticles.length !== 1 ? "s" : ""}
                  </span>
                )}
              </p>

              {/* Sparse-evidence notice — no development events in current feed window */}
              {!articlesLoading && companyArticles.length > 0 && developmentArticles.length === 0 && (
                <div className="mb-4 px-3 py-2.5 rounded-xl border border-border-base bg-parchment-mid">
                  <p className="font-sans text-[11px] font-semibold text-text-primary leading-snug">
                    No company events in this feed window.
                  </p>
                  <p className="font-sans text-[11px] text-text-secondary leading-snug mt-0.5">
                    {selectedCompany.name} appears in {contextArticles.length} sector context article{contextArticles.length !== 1 ? "s" : ""} — no earnings, funding, M&A, or IPO found. A context-led brief is available.
                  </p>
                </div>
              )}

              {/* Articles */}
              {articlesLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
                </div>
              ) : companyArticles.length === 0 ? (
                <EmptyState
                  icon={<Building2 size={24} />}
                  title="No articles found"
                  description="No recent articles mention this company"
                  className="py-8"
                />
              ) : (
                <div className="space-y-2">
                  {/* Company Events group — articles where the company was the actor */}
                  {developmentArticles.length > 0 && (
                    <>
                      <p className="font-data text-[8px] uppercase tracking-widest text-gold font-bold px-0.5 pb-0.5">
                        Company Events
                      </p>
                      {developmentArticles.map((a) => (
                        <div key={a.id} className="bg-white border border-gold/30 rounded-xl p-3">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-data text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide bg-gold-muted text-gold border border-gold-border flex-shrink-0">
                              {a.deal_type ?? "Event"}
                            </span>
                            {a.source && (
                              <span className="font-data text-[9px] text-text-muted">{a.source}</span>
                            )}
                            {a.published_at && (
                              <span className="font-data text-[9px] text-text-faint ml-auto">
                                {timeAgo(a.published_at)}
                              </span>
                            )}
                          </div>
                          <div className="flex items-start gap-2">
                            <h4 className="font-display text-[13px] font-bold text-espresso leading-snug flex-1">
                              {a.title}
                            </h4>
                            {a.url && (
                              <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-gold hover:text-gold-dark flex-shrink-0 mt-0.5">
                                <ExternalLink size={11} />
                              </a>
                            )}
                          </div>
                          {a.summary && (
                            <p className="font-sans text-[11px] text-text-secondary leading-snug mt-1 line-clamp-2">
                              {a.summary}
                            </p>
                          )}
                        </div>
                      ))}
                    </>
                  )}
                  {/* Sector Context group — macro, geopolitical, sector analysis */}
                  {contextArticles.length > 0 && (
                    <>
                      <p className={cn(
                        "font-data text-[8px] uppercase tracking-widest text-text-faint font-bold px-0.5 pb-0.5",
                        developmentArticles.length > 0 && "mt-3",
                      )}>
                        Sector Context
                      </p>
                      {contextArticles.map((a) => (
                        <div key={a.id} className="bg-white border border-border-base rounded-xl p-3">
                          <div className="flex items-center gap-2 mb-1">
                            {a.sector && (
                              <span
                                style={getSectorStyle(a.sector)}
                                className="font-sans text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide"
                              >
                                {a.sector}
                              </span>
                            )}
                            {a.source && (
                              <span className="font-data text-[9px] text-text-muted">{a.source}</span>
                            )}
                            {a.published_at && (
                              <span className="font-data text-[9px] text-text-faint ml-auto">
                                {timeAgo(a.published_at)}
                              </span>
                            )}
                          </div>
                          <div className="flex items-start gap-2">
                            <h4 className="font-display text-[13px] font-bold text-espresso leading-snug flex-1">
                              {a.title}
                            </h4>
                            {a.url && (
                              <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-gold hover:text-gold-dark flex-shrink-0 mt-0.5">
                                <ExternalLink size={11} />
                              </a>
                            )}
                          </div>
                          {a.summary && (
                            <p className="font-sans text-[11px] text-text-secondary leading-snug mt-1 line-clamp-2">
                              {a.summary}
                            </p>
                          )}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {selectedCompany && (
        <MemoModal
          isOpen={memoOpen}
          onClose={() => setMemoOpen(false)}
          title={selectedCompany.name}
          content={memoContent}
          type="company"
          systemPrompt={(() => {
            const identity = COMPANY_IDENTITY[selectedCompany.name];
            // Company Brief appears unconditionally as the first section.
            // When identity is present: curated brief is injected and output verbatim.
            // When identity is absent: model instruction omits the section rather than inventing content.
            const companyBriefBlock = identity
              ? `**Company Brief**\n${identity.brief}`
              : `[No curated Company Brief available — omit this section entirely]`;
            return `You are a sector analyst. Write a company intelligence brief for ${selectedCompany.name}. Output only user-facing prose — never reproduce bracketed instructions or meta-directives.

INPUTS: MEMO_MODE | SIGNAL QUALITY | COMPANY DEVELOPMENT ARTICLES | SECTOR CONTEXT ARTICLES

─── ALWAYS FIRST ───
${companyBriefBlock}

─── MEMO_MODE = "developments-led" ───
**Recent Developments**
[Facts from COMPANY DEVELOPMENT ARTICLES only. Specific figures, dates, named outcomes. Do not draw from context articles.]

**Market Context**
[2–3 sentences using only events named in SECTOR CONTEXT ARTICLES. Do not write generic sector trends. Do not reference events, companies, or data not present in those articles.]

**Key Watchpoints**
[1–3 bullets. Each must name a specific upcoming event or unresolved condition from COMPANY DEVELOPMENT ARTICLES. Do not pad with invented milestones.]

**Signal Quality**
[SIGNAL QUALITY value.] [One sentence on what the evidence covers.]

─── MEMO_MODE = "context-led" ───
**Coverage Note**
No direct company developments found in the current feed window.

**Current Context**
[2–3 sentences. Use only events, companies, and figures that appear by name in SECTOR CONTEXT ARTICLES. Do not write generic sector narratives. Do not name events not present in the listed articles.]

**What To Watch**
[2 bullets. Each must name a specific event or condition from SECTOR CONTEXT ARTICLES — e.g., a named regulatory action, contract decision, or macro data release. No generic macro risks. No inferred impact on ${selectedCompany.name}.]

**Signal Quality**
[SIGNAL QUALITY value.] [One sentence on what the evidence covers.]

─── RULES ───
Company Brief: if present above, output verbatim — do not rephrase or expand. If marked [No curated Company Brief available], omit that section entirely.
No: "may benefit", "stands to benefit", "is poised to", "faces exposure to", "could". Do not infer ${selectedCompany.name}'s position from partner or competitor activity. Every factual claim must appear in the input. Under 300 words.`;
          })()}
        />
      )}
    </AppShell>
  );
}

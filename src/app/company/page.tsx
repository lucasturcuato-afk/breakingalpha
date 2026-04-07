"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Search, Building2, Bookmark, Sparkles, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@supabase/supabase-js";
import { getSectorStyle } from "@/lib/sector-colors";
import { MemoModal } from "@/components/memo/MemoModal";

function getSupabase() {
  return createClient(
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

// Canonical name map — keys are lowercase variants, value is display name
const CANONICAL: Record<string, string> = {
  nvidia: "NVIDIA",
  "nvidia corporation": "NVIDIA",
  "nvidia corp": "NVIDIA",
  alphabet: "Alphabet",
  "alphabet inc": "Alphabet",
  "alphabet inc.": "Alphabet",
  google: "Alphabet",
  "google llc": "Alphabet",
  "google inc": "Alphabet",
  meta: "Meta",
  "meta platforms": "Meta",
  "meta platforms inc": "Meta",
  "meta platforms, inc.": "Meta",
  facebook: "Meta",
  "amazon.com": "Amazon",
  "amazon.com inc": "Amazon",
  "amazon.com, inc.": "Amazon",
  amazon: "Amazon",
  "apple inc": "Apple",
  "apple inc.": "Apple",
  apple: "Apple",
  "microsoft corporation": "Microsoft",
  "microsoft corp": "Microsoft",
  microsoft: "Microsoft",
  "jpmorgan chase": "JPMorgan Chase",
  "jpmorgan chase & co": "JPMorgan Chase",
  "jp morgan": "JPMorgan Chase",
  "jpmorgan": "JPMorgan Chase",
  "goldman sachs": "Goldman Sachs",
  "goldman sachs group": "Goldman Sachs",
  "the goldman sachs group": "Goldman Sachs",
  "berkshire hathaway": "Berkshire Hathaway",
  "berkshire hathaway inc": "Berkshire Hathaway",
};

// Company industry map — what the company IS, not what stories cover it.
// Only hardcode what we can state with confidence. Unmapped companies get no identity line.
const COMPANY_INDUSTRY: Record<string, string> = {
  // Semiconductors & Hardware
  "NVIDIA":              "Semiconductors",
  "Intel":               "Semiconductors",
  // Consumer & Enterprise Technology
  "Apple":               "Consumer Technology",
  "Microsoft":           "Technology",
  "Alphabet":            "Technology",
  "Meta":                "Technology",
  "Amazon":              "Technology / E-Commerce",
  "Tesla":               "Electric Vehicles",
  "Salesforce":          "Enterprise Software",
  "Oracle":              "Enterprise Technology",
  "Palantir":            "Data Analytics",
  "IBM":                 "Technology",
  // Artificial Intelligence
  "OpenAI":              "Artificial Intelligence",
  "Anthropic":           "Artificial Intelligence",
  // Aerospace & Defense
  "Lockheed Martin":     "Aerospace & Defense",
  "Boeing":              "Aerospace & Defense",
  "Raytheon":            "Aerospace & Defense",
  "Northrop Grumman":    "Aerospace & Defense",
  "SpaceX":              "Aerospace",
  "General Dynamics":    "Aerospace & Defense",
  // Financial Services
  "JPMorgan Chase":      "Financial Services",
  "Goldman Sachs":       "Investment Banking",
  "Morgan Stanley":      "Investment Banking",
  "Bank of America":     "Financial Services",
  "Berkshire Hathaway":  "Diversified Financials",
  "BlackRock":           "Asset Management",
  "Visa":                "Financial Technology",
  "Mastercard":          "Financial Technology",
  // Healthcare & Pharma
  "Pfizer":              "Pharmaceuticals",
  "Johnson & Johnson":   "Healthcare",
  // Energy & Consumer
  "ExxonMobil":          "Energy",
  "Chevron":             "Energy",
  "Walmart":             "Consumer Retail",
};

function canonicalize(name: string): string {
  const key = name.trim().toLowerCase().replace(/[.,]$/g, "");
  return CANONICAL[key] ?? name.trim();
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
        const { data: articles } = await getSupabase()
          .from("articles")
          .select("companies, sector")
          .order("ingested_at", { ascending: false })
          .limit(500);

        if (!articles) return;

        const compMap: Record<string, { mentions: number; sectors: Set<string> }> = {};
        articles.forEach((a) => {
          const cos = parseCompanies(a.companies);
          cos.forEach((raw) => {
            if (!raw || raw.length < 2) return;
            const c = canonicalize(raw);
            if (!compMap[c]) compMap[c] = { mentions: 0, sectors: new Set() };
            compMap[c].mentions++;
            if (a.sector) compMap[c].sectors.add(a.sector);
          });
        });

        const list = Object.entries(compMap)
          .map(([name, data]) => ({
            name,
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
    const industry = COMPANY_INDUSTRY[selectedCompany.name] ?? "Unknown";

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
        const { data: articles } = await getSupabase()
          .from("articles")
          .select("id, title, source, sector, sentiment, summary, published_at, ingested_at, url, companies, primary_company, relevance_score, deal_type")
          .order("ingested_at", { ascending: false })
          .limit(500);

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

          // DEBUG: log raw fields for every matched article so root cause is verifiable
          // in the browser console. Remove after preview confirms fix.
          console.group(`[CompanyIntel] matched articles for "${name}" (${matched.length})`);
          matched.forEach((a) => {
            const dt = typeof a.deal_type === "string" ? a.deal_type : null;
            const pc = a.primary_company ?? null;
            const strictPass =
              (dt === "Earnings" || dt === "M&A") &&
              pc != null &&
              matchesCanonical(pc, name);
            const relaxedPass =
              (dt === "Funding" || dt === "IPO") &&
              (pc == null || matchesCanonical(pc, name));
            console.log({
              title: a.title.slice(0, 60),
              deal_type: dt,
              primary_company: pc,
              companies: parseCompanies(a.companies),
              _isDevelopment: strictPass || relaxedPass,
              _strictPass: strictPass,
              _relaxedPass: relaxedPass,
            });
          });
          console.groupEnd();

          const mapped = matched.map((a) => {
            // Development classification: does this article describe something the company DID?
            //
            // Development = the SELECTED COMPANY was the PRIMARY ACTOR in this article.
            // Tiered gate — different event types warrant different strictness:
            //
            // STRICT (Earnings, M&A): require primary_company match.
            //   These events have one clear actor. null primary_company = genuine ambiguity.
            //   "Hon Hai Q1 earnings"   → primary_company="Hon Hai"  → context for NVIDIA ✓
            //   "Apple Q3 results"      → primary_company="Apple"    → development for Apple ✓
            //
            // RELAXED (Funding, IPO): allow primary_company = null.
            //   Funding articles name one company raising money; investors co-mentioned cause
            //   ingest to return null even though the funded company is the unambiguous actor.
            //   "Whoop raises $575M Series G" → primary_company=null (investors listed) → still
            //   a Whoop development because Whoop is in companies[] and deal_type="Funding".
            //   Risk: competitor funding articles with null primary_company and NVIDIA in
            //   companies[] as context would also qualify. Accept this: it is less wrong
            //   than zeroing out every startup's own funding events.
            const isStrictDevelopment =
              (a.deal_type === "Earnings" || a.deal_type === "M&A") &&
              a.primary_company != null &&
              matchesCanonical(a.primary_company, name);

            const isFundingOrIPO =
              (a.deal_type === "Funding" || a.deal_type === "IPO") &&
              (a.primary_company == null || matchesCanonical(a.primary_company, name));

            const isDevelopment = isStrictDevelopment || isFundingOrIPO;

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
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
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
          systemPrompt={`You are a sector analyst. Write a company intelligence brief for ${selectedCompany.name}. Output only user-facing prose — never reproduce bracketed instructions or meta-directives.

INPUTS: MEMO_MODE | SIGNAL QUALITY | COMPANY DEVELOPMENT ARTICLES | SECTOR CONTEXT ARTICLES

─── MEMO_MODE = "developments-led" ───
${COMPANY_INDUSTRY[selectedCompany.name] ? `
**Company Brief**
${selectedCompany.name} is a ${COMPANY_INDUSTRY[selectedCompany.name]} company. [One phrase: primary business.]
` : ''}
**Recent Developments**
[Facts from COMPANY DEVELOPMENT ARTICLES only. Specific figures, dates, named outcomes. No context articles.]

**Market Context**
[2–3 sentences from SECTOR CONTEXT ARTICLES as backdrop.]

**Key Watchpoints**
[1–3 bullets from COMPANY DEVELOPMENT ARTICLES. Named upcoming events only. Do not pad.]

**Signal Quality**
[SIGNAL QUALITY value.] [One sentence on what the evidence covers.]

─── MEMO_MODE = "context-led" ───
${COMPANY_INDUSTRY[selectedCompany.name] ? `
**Company Brief**
${selectedCompany.name} is a ${COMPANY_INDUSTRY[selectedCompany.name]} company. [One phrase: primary business.]
` : ''}
**Coverage Note**
No direct company developments found in the current feed window.

**Current Context**
[2–3 sentences from SECTOR CONTEXT ARTICLES. Name specific events — no generic commentary.]

**What To Watch**
[2 bullets. Each names a specific event or condition from SECTOR CONTEXT ARTICLES. No inferred company benefit. No invented events.]

**Signal Quality**
[SIGNAL QUALITY value.] [One sentence on what the evidence covers.]

─── RULES ───
No: "may benefit", "stands to benefit", "is poised to", "faces exposure to", "could". Do not infer this company's impact from partner or competitor activity. Every factual claim must appear in the input. Under 300 words.`}
        />
      )}
    </AppShell>
  );
}

"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Search, Building2, Bookmark, Sparkles, ExternalLink, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { createBrowserClient } from "@supabase/ssr";
import { getSectorStyle } from "@/lib/sector-colors";
import { MemoModal } from "@/components/memo/MemoModal";
import { SignInModal } from "@/components/auth/sign-in-modal";
import {
  CompanyArticle,
  buildMemoContent,
  buildMemoSystemPrompt,
  canonicalize,
  filterAndClassifyArticles,
  isJunkEntityName,
  parseCompanies,
  timeAgo,
} from "@/lib/company-intel";
import { CompletenessBadge, SignalScore, SourceCredibilityBadge, getCompleteness, getAdjustedScore } from "@/lib/article-signal";
import type { Completeness } from "@/lib/article-signal";

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

const INDUSTRY_VERTICALS = [
  "Technology",
  "Healthcare & Biotech",
  "Energy & Oil/Gas",
  "Financial Services",
  "Consumer & Retail",
  "Industrials & Manufacturing",
  "Aerospace & Defense",
  "Real Estate",
  "Media & Telecom",
  "Materials & Mining",
  "Agriculture",
] as const;

// Explicit mapping from article sector strings (old and new taxonomy) to INDUSTRY_VERTICALS.
// Uses a deterministic lookup instead of fuzzy keyword matching to avoid false positives —
// e.g. "Technology M&A & Investment Banking" would incorrectly fire for PE firms like Blackstone
// under a keyword approach; here it maps to Technology (where the target companies live).
// "Private Equity & Buyouts" maps to Financial Services, not Technology.
const SECTOR_TO_VERTICAL: Record<string, string> = {
  // New taxonomy direct matches
  "Technology": "Technology",
  "Healthcare & Biotech": "Healthcare & Biotech",
  "Energy & Oil/Gas": "Energy & Oil/Gas",
  "Financial Services": "Financial Services",
  "Consumer & Retail": "Consumer & Retail",
  "Aerospace & Defense": "Aerospace & Defense",
  "Real Estate": "Real Estate",
  // Old taxonomy mapped to canonical INDUSTRY_VERTICALS
  "Technology M&A & Investment Banking": "Technology",
  "Venture Capital & Startup Funding": "Financial Services",
  "Private Equity & Buyouts": "Financial Services",
  "Public Markets & Earnings": "Financial Services",
  "Fintech & Crypto": "Financial Services",
  "M&A & Investment Banking": "Financial Services",
  "Energy & Climate": "Energy & Oil/Gas",
  "Real Estate & Infrastructure": "Real Estate",
  "Real Estate & REITs": "Real Estate",
  // "Geopolitics & Macro" intentionally unmapped — cross-cutting, not an industry vertical
};

// Layer 1: ground-truth vertical for well-known companies. Keyed by lowercase display name.
// Checked before sector-derived logic — overrides any article sector signal for these companies.
// An AI company like Anthropic appearing in "Fintech & Crypto" articles should still map to
// Technology; a PE firm like Blackstone should map to Financial Services regardless of which
// industry its portfolio companies are in.
const COMPANY_VERTICAL_OVERRIDES: Record<string, string> = {
  // AI & cloud infrastructure
  "anthropic": "Technology",
  "anthropic pbc": "Technology",
  "openai": "Technology",
  "xai": "Technology",
  "coreweave": "Technology",
  // Big Tech
  "alphabet": "Technology",
  "google": "Technology",
  "microsoft": "Technology",
  "apple": "Technology",
  "amazon": "Technology",
  "meta": "Technology",
  "nvidia": "Technology",
  "intel": "Technology",
  "samsung": "Technology",
  "ibm": "Technology",
  "broadcom": "Technology",
  "arm": "Technology",
  "arm holdings": "Technology",
  "tesla": "Technology",
  "uber": "Technology",
  "palantir": "Technology",
  "palantir technologies": "Technology",
  "roblox": "Technology",
  "sifive": "Technology",
  "polymarket": "Technology",
  // IT services / consulting
  "tcs": "Technology",
  "tata consultancy services": "Technology",
  // Aerospace & Defense
  "spacex": "Aerospace & Defense",
  "lockheed martin": "Aerospace & Defense",
  "boeing": "Aerospace & Defense",
  "northrop grumman": "Aerospace & Defense",
  "nasa": "Aerospace & Defense",
  // Financial Services
  "blackstone": "Financial Services",
  "blackstone group": "Financial Services",
  "goldman sachs": "Financial Services",
  "tpg": "Financial Services",
  "federal reserve": "Financial Services",
  "federal reserve board": "Financial Services",
  "jpmorgan": "Financial Services",
  "jpmorgan chase": "Financial Services",
  "morgan stanley": "Financial Services",
  "bank of america": "Financial Services",
  "citigroup": "Financial Services",
  "nordea bank": "Financial Services",
  "nordea bank abp": "Financial Services",
  "cango": "Financial Services",
  "cango inc": "Financial Services",
  "kreditbee": "Financial Services",
  // Media & Telecom
  "bloomberg": "Media & Telecom",
  "techcrunch": "Media & Telecom",
  "paramount": "Media & Telecom",
  "warner bros": "Media & Telecom",
  "warner brothers": "Media & Telecom",
  "comcast": "Media & Telecom",
  "disney": "Media & Telecom",
  // Industrials & Manufacturing
  "delta": "Industrials & Manufacturing",
  "volkswagen": "Industrials & Manufacturing",
  "ford": "Industrials & Manufacturing",
  "general motors": "Industrials & Manufacturing",
  // Energy
  "exxonmobil": "Energy & Oil/Gas",
  "chevron": "Energy & Oil/Gas",
  "bp": "Energy & Oil/Gas",
  "shell": "Energy & Oil/Gas",
  // Healthcare
  "hologic": "Healthcare & Biotech",
  "hologic inc": "Healthcare & Biotech",
  "pfizer": "Healthcare & Biotech",
  "johnson & johnson": "Healthcare & Biotech",
  "unitedhealth": "Healthcare & Biotech",
  // Consumer & Retail
  "peloton": "Consumer & Retail",
  "slice": "Consumer & Retail",
  "nike": "Consumer & Retail",
  "walmart": "Consumer & Retail",
};

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
  const [selectedVerticals, setSelectedVerticals] = useState<string[]>([]);
  const [verticalMatchMode, setVerticalMatchMode] = useState<"any" | "all">("any");
  const [credMap, setCredMap] = useState<Map<string, number>>(new Map());
  const [isSignedOut, setIsSignedOut] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    supabase.auth.getUser().then(({ data: { user } }) => {
      setIsSignedOut(user === null);
    }).catch(() => setIsSignedOut(true));
  }, []);

  // Build company list from article mentions
  useEffect(() => {
    async function load() {
      try {
        const { data: articles, error: articlesErr } = await getSupabase()
          .from("articles")
          .select("companies, sector, primary_company")
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
            // Reject extraction artifacts: parenthetical lists, "e.g." patterns,
            // generic group labels, and implausibly long strings.
            if (isJunkEntityName(raw)) return;
            const display = canonicalize(raw);
            const key = display.toLowerCase();
            if (!compMap[key]) {
              compMap[key] = { display, mentions: 0, sectors: new Set() };
            } else if (/[a-z]/.test(display) && !/[a-z]/.test(compMap[key].display)) {
              // Upgrade from ALL-CAPS to mixed-case display form when available
              compMap[key].display = display;
            }
            compMap[key].mentions++;
            // Only attribute a sector to a company when it is the primary subject of the article.
            // Without this guard, PE firms like Blackstone accumulate "Healthcare & Biotech" from
            // articles where Hologic (primary_company) is the subject and Blackstone is the acquirer.
            // Fall back to adding the sector when primary_company is unset (older articles).
            if (a.sector) {
              const pc = typeof a.primary_company === "string" ? canonicalize(a.primary_company).toLowerCase() : "";
              if (!pc || pc === key || pc.includes(key) || key.includes(pc)) {
                compMap[key].sectors.add(a.sector);
              }
            }
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

  // Filter companies by search and industry vertical.
  // Two-layer approach:
  //   Layer 1: COMPANY_VERTICAL_OVERRIDES — ground-truth for well-known companies. When a
  //            company has an override, its article-derived sectors[] are ignored entirely.
  //            This prevents Anthropic (primary in "Fintech & Crypto" articles) from appearing
  //            under Financial Services, and Blackstone from appearing under Technology.
  //   Layer 2: SECTOR_TO_VERTICAL — deterministic sector string → vertical mapping as fallback
  //            for long-tail companies not in the override map.
  const filtered = useMemo(() => {
    let result = companies;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) => c.name.toLowerCase().includes(q));
    }
    if (selectedVerticals.length > 0) {
      result = result.filter((c) => {
        const nameLower = c.name.toLowerCase();
        const override = COMPANY_VERTICAL_OVERRIDES[nameLower];
        // Layer 1: if we have ground-truth, use it exclusively
        const effectiveVerticals: Set<string> = override
          ? new Set([override])
          : new Set(c.sectors.map((s) => SECTOR_TO_VERTICAL[s]).filter((v): v is string => Boolean(v)));
        return verticalMatchMode === "all"
          ? selectedVerticals.every((v) => effectiveVerticals.has(v))
          : selectedVerticals.some((v) => effectiveVerticals.has(v));
      });
    }
    return result;
  }, [companies, search, selectedVerticals, verticalMatchMode]);

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

  const memoContent = useMemo(() => {
    if (!selectedCompany) return "";
    return buildMemoContent(selectedCompany.name, developmentArticles, contextArticles);
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
          .select("id, title, source, sector, sentiment, summary, content, published_at, ingested_at, url, companies, primary_company, relevance_score, deal_type")
          .order("ingested_at", { ascending: false })
          .limit(1500);

        if (detailErr) {
          console.error("Company articles query error:", detailErr.message);
          return;
        }
        if (articles) {
          setCompanyArticles(filterAndClassifyArticles(articles, name));

          // Batch fetch source credibility
          const uniqueSources = [...new Set(articles.map(a => a.source).filter(Boolean) as string[])];
          if (uniqueSources.length > 0) {
            try {
              const { data: credData } = await getSupabase()
                .from("source_credibility")
                .select("source, win_rate")
                .in("source", uniqueSources);
              setCredMap(new Map(credData?.map(r => [r.source, r.win_rate]) ?? []));
            } catch { /* soft-fail */ }
          }
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
          <h2 className="font-display text-[22px] font-extrabold text-espresso mb-1">
            Company Intel
          </h2>
          <p className="font-sans text-[13px] text-text-secondary mb-5">
            Companies extracted from {companies.length > 0 ? `${companies.length} article mentions` : "your news feed"}. Click any company to see related coverage.
          </p>

          {/* Preview nudge banner */}
          {isSignedOut && (
            <div className="mb-5 px-4 py-3 rounded-xl border border-gold/20 flex items-center justify-between" style={{ backgroundColor: "var(--gold-muted)" }}>
              <p className="font-sans text-[12px] text-text-secondary">
                Previewing company intelligence — sign in to search, filter, and track companies.
              </p>
              <button
                type="button"
                onClick={() => setShowSignIn(true)}
                className="flex-shrink-0 ml-4 font-sans text-[12px] font-semibold cursor-pointer"
                style={{ color: "var(--espresso)" }}
              >
                Sign in free →
              </button>
            </div>
          )}

          {/* Search */}
          {isSignedOut ? (
            <div className="relative mb-4 flex items-center gap-1.5 px-3 py-2.5 rounded-lg border border-border-base bg-parchment-mid">
              <Lock size={13} className="text-text-faint" />
              <span className="font-sans text-[12px] text-text-faint">Search available after sign in</span>
            </div>
          ) : (
            <div className="relative mb-4">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search companies..."
                className="pl-9 font-sans"
              />
            </div>
          )}

          {/* Industry Vertical Filter */}
          {isSignedOut ? (
            <div className="mb-5 flex items-center gap-1.5">
              <Lock size={12} className="text-text-faint" />
              <span className="font-sans text-[12px] text-text-faint">Sector filters available after sign in</span>
            </div>
          ) : (
            <div className="mb-5">
              <p className="font-data text-[9px] uppercase tracking-widest text-gold mb-1.5">Sector</p>
              <div className="flex items-center gap-1.5 flex-wrap">
                {INDUSTRY_VERTICALS.map((v) => {
                  const isActive = selectedVerticals.includes(v);
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() =>
                        setSelectedVerticals((prev) =>
                          prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v],
                        )
                      }
                      className={cn(
                        "px-3 py-1 rounded-lg font-data text-[10px] font-bold uppercase cursor-pointer transition-colors border",
                        isActive
                          ? "border-gold bg-gold-muted text-gold"
                          : "border-border-base bg-white text-text-muted hover:text-text-primary",
                      )}
                    >
                      {v}
                    </button>
                  );
                })}
                {selectedVerticals.length > 0 && (
                  <button
                    type="button"
                    onClick={() => { setSelectedVerticals([]); setVerticalMatchMode("any"); }}
                    className="px-3 py-1 font-data text-[10px] text-text-muted hover:text-text-primary cursor-pointer transition-colors"
                  >
                    Clear filters
                  </button>
                )}
              </div>
              {selectedVerticals.length >= 2 && (
                <div className="flex items-center gap-1.5 mt-2">
                  <span className="font-data text-[9px] uppercase tracking-widest text-text-faint">Match:</span>
                  {(["any", "all"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setVerticalMatchMode(mode)}
                      className={cn(
                        "px-2.5 py-0.5 rounded font-data text-[9px] font-bold uppercase cursor-pointer transition-colors border",
                        verticalMatchMode === mode
                          ? "border-gold bg-gold-muted text-gold"
                          : "border-border-base bg-white text-text-muted hover:text-text-primary",
                      )}
                    >
                      {mode === "any" ? "Match Any" : "Match All"}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Company grid */}
          {loading ? (
            <div className="grid grid-cols-3 gap-2">
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
            <div>
              <div className="grid grid-cols-3 gap-2">
                {(isSignedOut ? filtered.slice(0, 6) : filtered).map((company) => (
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
              {isSignedOut && filtered.length > 6 && (
                <div className="relative mt-2">
                  <div
                    className="pointer-events-none absolute -top-16 left-0 right-0 h-16"
                    style={{ background: "linear-gradient(to bottom, transparent, var(--parchment))" }}
                  />
                  <div
                    className="flex items-center justify-between px-4 py-3 rounded-xl border"
                    style={{ borderColor: "rgba(201,146,42,0.3)", backgroundColor: "var(--gold-muted)" }}
                  >
                    <div className="flex items-center gap-2">
                      <Lock size={14} style={{ color: "var(--gold)" }} />
                      <span className="font-sans text-[13px] font-semibold text-espresso">
                        Sign in to see all {filtered.length} companies
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowSignIn(true)}
                      className="font-sans text-[12px] font-semibold cursor-pointer"
                      style={{ color: "var(--gold)" }}
                    >
                      Sign in →
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
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
                  onClick={() => { if (isSignedOut) { setShowSignIn(true); return; } handleAddToWatchlist(selectedCompany.name); }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-parchment-mid border border-border-base font-sans text-[11px] font-medium text-text-secondary hover:border-border-hover transition-colors cursor-pointer"
                >
                  <Bookmark size={11} />
                  Add to Watchlist
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      if (isSignedOut) { setShowSignIn(true); return; }
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
                      {developmentArticles.map((a) => {
                        const cmplt = getCompleteness(a.content, a.summary);
                        return (
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
                            <CompletenessBadge completeness={cmplt} />
                            <SignalScore score={getAdjustedScore(a.relevance_score ?? null, cmplt)} />
                            <SourceCredibilityBadge winRate={a.source ? credMap.get(a.source) ?? null : null} />
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
                        );
                      })}
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
                      {contextArticles.map((a) => {
                        const cmplt = getCompleteness(a.content, a.summary);
                        return (
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
                            <CompletenessBadge completeness={cmplt} />
                            <SignalScore score={getAdjustedScore(a.relevance_score ?? null, cmplt)} />
                            <SourceCredibilityBadge winRate={a.source ? credMap.get(a.source) ?? null : null} />
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
                        );
                      })}
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
          systemPrompt={buildMemoSystemPrompt(selectedCompany.name)}
        />
      )}
      <SignInModal
        isOpen={showSignIn}
        onClose={() => setShowSignIn(false)}
        headline="Sign in to unlock Company Intel"
        message="Create a free account to search, filter, track watchlists, and generate company memos."
      />
    </AppShell>
  );
}

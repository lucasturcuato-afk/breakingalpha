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

export default function CompanyIntelPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [companies, setCompanies] = useState<CompanyData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCompany, setSelectedCompany] = useState<CompanyData | null>(null);
  const [companyArticles, setCompanyArticles] = useState<CompanyArticle[]>([]);
  const [articlesLoading, setArticlesLoading] = useState(false);
  const [memoOpen, setMemoOpen] = useState(false);

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
          cos.forEach((c) => {
            if (!c || c.length < 2) return;
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

  // Load articles when a company is selected
  useEffect(() => {
    if (!selectedCompany) return;
    setArticlesLoading(true);
    setCompanyArticles([]);

    async function loadArticles() {
      try {
        const name = selectedCompany!.name;
        const { data: articles } = await getSupabase()
          .from("articles")
          .select("id, title, source, sector, sentiment, summary, published_at, ingested_at, url, companies")
          .ilike("companies", `%${name}%`)
          .order("ingested_at", { ascending: false })
          .limit(100);

        if (articles) {
          const nameLower = name.toLowerCase();
          const matched = articles.filter((a) => {
            const cos = parseCompanies(a.companies);
            return cos.some((c) => c.toLowerCase() === nameLower);
          });

          setCompanyArticles(matched.map((a) => ({
            id: a.id,
            title: a.title,
            source: a.source,
            sector: a.sector,
            sentiment: a.sentiment,
            summary: a.summary,
            published_at: a.published_at || a.ingested_at,
            url: a.url,
          })));
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
                    {company.sectors.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {company.sectors.slice(0, 2).map((s) => (
                          <span
                            key={s}
                            style={getSectorStyle(s)}
                            className="font-sans text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    )}
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
              {/* Sectors */}
              {selectedCompany.sectors.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {selectedCompany.sectors.map((s) => (
                    <span
                      key={s}
                      style={getSectorStyle(s)}
                      className="font-sans text-[9px] font-semibold px-2 py-0.5 rounded uppercase tracking-wide"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              )}

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
                <button
                  type="button"
                  onClick={() => setMemoOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gold text-cream font-sans text-[11px] font-semibold hover:bg-gold-dark transition-colors cursor-pointer"
                >
                  <Sparkles size={11} />
                  Generate Memo
                </button>
              </div>

              {/* Articles header */}
              <p className="font-data text-[9px] uppercase tracking-widest text-gold font-semibold mb-3">
                Articles Mentioning {selectedCompany.name.toUpperCase()} ({companyArticles.length})
              </p>

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
                  {companyArticles.map((a) => (
                    <div
                      key={a.id}
                      className="bg-white border border-border-base rounded-xl p-3"
                    >
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
          content={`${selectedCompany.name} — ${selectedCompany.sectors.join(", ")}\nMentions: ${selectedCompany.mentions}\n\n${companyArticles.slice(0, 10).map((a) => `${a.title}${a.summary ? ": " + a.summary : ""}`).join("\n\n")}`}
          type="article"
        />
      )}
    </AppShell>
  );
}

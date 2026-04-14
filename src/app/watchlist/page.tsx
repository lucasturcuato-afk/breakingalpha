"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import {
  Star,
  Trash2,
  Sparkles,
  ExternalLink,
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronRight,
} from "lucide-react";
import { createBrowserClient } from "@supabase/ssr";
import { MemoModal } from "@/components/memo/MemoModal";

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
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

const STALE_TO_CANONICAL: Record<string, string> = {
  "FINANCE": "Financial Services",
  "TECHNOLOGY": "Technology",
  "TECHNOLOGY M&A": "Technology",
  "PUBLIC MARKETS": "Financial Services",
  "GEOPOLITICS & MACRO": "Financial Services",
  "FINTECH & CRYPTO": "Financial Services",
  "HEALTHCARE & BIOTECH": "Healthcare & Biotech",
  "ENERGY & CLIMATE": "Energy & Oil/Gas",
  "PRIVATE EQUITY": "Financial Services",
  "VENTURE CAPITAL": "Financial Services",
};

interface WatchlistEntry {
  id: string;
  identifier: string;
  type: string;
  created_at?: string;
}

interface WatchlistPrice {
  price: string;
  pct: number;
}

interface MatchedArticle {
  id: string;
  title: string;
  source?: string;
  sector?: string;
  industry_verticals?: string[];
  activity_types?: string[];
  published_at?: string;
  relevance_score?: number;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function sortArticles(articles: MatchedArticle[], mode: "newest" | "relevant"): MatchedArticle[] {
  if (mode === "newest") {
    return [...articles].sort((a, b) =>
      new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime()
    );
  }
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  return [...articles].sort((a, b) => {
    const aRecent = now - new Date(a.published_at || 0).getTime() < sevenDays ? 1 : 0;
    const bRecent = now - new Date(b.published_at || 0).getTime() < sevenDays ? 1 : 0;
    if (aRecent !== bRecent) return bRecent - aRecent;
    return (b.relevance_score ?? 0) - (a.relevance_score ?? 0);
  });
}

async function fetchArticlesForEntry(entry: WatchlistEntry): Promise<MatchedArticle[]> {
  const ident = entry.identifier.toLowerCase();
  let query;
  if (entry.type === "sector") {
    query = getSupabase()
      .from("articles")
      .select("id, title, source, sector, industry_verticals, activity_types, published_at, ingested_at, summary, companies")
      .contains("industry_verticals", [entry.identifier])
      .order("ingested_at", { ascending: false })
      .limit(20);
  } else {
    query = getSupabase()
      .from("articles")
      .select("id, title, source, sector, industry_verticals, activity_types, published_at, ingested_at, summary, companies, relevance_score")
      .or(`title.ilike.%${ident}%,companies.cs.["${entry.identifier}"]`)
      .order("ingested_at", { ascending: false })
      .limit(20);
  }
  const { data } = await query;
  return (data || []).map((a: Record<string, unknown>) => ({
    id: a.id as string,
    title: a.title as string,
    source: a.source as string | undefined,
    sector: a.sector as string | undefined,
    industry_verticals: (a.industry_verticals as string[] | null) ?? [],
    activity_types: (a.activity_types as string[] | null) ?? [],
    published_at: (a.published_at as string | null) || (a.ingested_at as string | null) || undefined,
    relevance_score: (a.relevance_score as number | null) ?? 0,
  }));
}

function buildWatchlistMemoContent(entry: WatchlistEntry, articles: MatchedArticle[]): string {
  const lines = [
    `Watchlist item: ${entry.identifier}`,
    `Type: ${entry.type}`,
    "",
    `Recent articles (${articles.length} total):`,
  ];
  articles.slice(0, 10).forEach((a) => {
    const date = a.published_at ? timeAgo(a.published_at) : "unknown";
    lines.push(`- ${a.title} (${a.source ?? "unknown"}, ${date})`);
  });
  return lines.join("\n");
}

export default function WatchlistPage() {
  const router = useRouter();
  const [memoEntry, setMemoEntry] = useState<WatchlistEntry | null>(null);
  const [articleMemoEntry, setArticleMemoEntry] = useState<MatchedArticle | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [prices, setPrices] = useState<Record<string, WatchlistPrice>>({});
  const [articlesByIdentifier, setArticlesByIdentifier] = useState<Record<string, MatchedArticle[]>>({});
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [addType, setAddType] = useState<"ticker" | "company" | "sector">("ticker");
  const [addError, setAddError] = useState("");
  const [selectedIdentifier, setSelectedIdentifier] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<"newest" | "relevant">("newest");

  const fetchPrices = useCallback((entries: WatchlistEntry[]) => {
    const tickers = entries.filter((e) => e.type === "ticker").map((e) => e.identifier);
    if (tickers.length > 0) {
      fetch(`/api/watchlist-quotes?symbols=${tickers.join(",")}`)
        .then((r) => r.json())
        .then((d) => { if (d.quotes) setPrices(d.quotes); })
        .catch(() => {});
    }
  }, []);

  const fetchAllArticles = useCallback(async (entries: WatchlistEntry[]) => {
    if (entries.length === 0) {
      setArticlesByIdentifier({});
      return;
    }
    const results = await Promise.allSettled(
      entries.map(async (entry) => ({
        identifier: entry.identifier,
        articles: await fetchArticlesForEntry(entry),
      }))
    );
    const byIdent: Record<string, MatchedArticle[]> = {};
    results.forEach((r) => {
      if (r.status === "fulfilled") {
        byIdent[r.value.identifier] = r.value.articles;
      }
    });
    setArticlesByIdentifier(byIdent);
  }, []);

  const refreshWatchlist = useCallback(async () => {
    try {
      const res = await fetch("/api/watchlist");
      if (!res.ok) {
        console.error("Watchlist fetch failed:", res.status);
        return;
      }
      const { entries } = await res.json();
      const seen = new Set<string>();
      const newEntries = (entries || []).filter((e: WatchlistEntry) => {
        const key = `${e.identifier.toUpperCase()}::${e.type}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Stale sector auto-migration
      const staleSectors = newEntries.filter(
        (e: WatchlistEntry) => e.type === "sector" && STALE_TO_CANONICAL[e.identifier.toUpperCase()]
      );
      if (staleSectors.length > 0) {
        await Promise.all(
          staleSectors.map(async (e: WatchlistEntry) => {
            const canonical = STALE_TO_CANONICAL[e.identifier.toUpperCase()];
            await fetch("/api/watchlist", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: e.id }),
            });
            await fetch("/api/watchlist", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ identifier: canonical, type: "sector" }),
            });
          })
        );
        // Re-fetch after migration
        const res2 = await fetch("/api/watchlist");
        if (!res2.ok) return;
        const { entries: entries2 } = await res2.json();
        const seen2 = new Set<string>();
        const migratedEntries = (entries2 || []).filter((e: WatchlistEntry) => {
          const key = `${e.identifier.toUpperCase()}::${e.type}`;
          if (seen2.has(key)) return false;
          seen2.add(key);
          return true;
        });
        setWatchlist(migratedEntries);
        await fetchAllArticles(migratedEntries);
        fetchPrices(migratedEntries);
        return;
      }

      setWatchlist(newEntries);
      await fetchAllArticles(newEntries);
      fetchPrices(newEntries);
    } catch (e) {
      console.error("Failed to refresh watchlist:", e);
    } finally {
      setLoading(false);
    }
  }, [fetchAllArticles, fetchPrices]);

  useEffect(() => {
    refreshWatchlist();
  }, [refreshWatchlist]);

  const handleAdd = async () => {
    const identifier = input.trim();
    if (!identifier) return;
    setAddError("");
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, type: addType }),
      });
      if (!res.ok) {
        const body = await res.json();
        setAddError(body.error || "Failed to add");
        return;
      }
      setInput("");
      await refreshWatchlist();
    } catch {
      setAddError("Network error");
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await fetch("/api/watchlist", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await refreshWatchlist();
    } catch (e) {
      console.error("Failed to remove:", e);
    }
  };

  const handleAddSector = async (sectorName: string) => {
    const isTracked = watchlist.some((e) => e.identifier.toLowerCase() === sectorName.toLowerCase());
    if (isTracked) return;
    try {
      await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: sectorName, type: "sector" }),
      });
      await refreshWatchlist();
    } catch (e) {
      console.error("Failed to add sector:", e);
    }
  };

  const tickers = watchlist.filter((e) => e.type === "ticker");
  const gainers = tickers.filter((e) => prices[e.identifier]?.pct > 0).length;
  const losers = tickers.filter((e) => prices[e.identifier]?.pct < 0).length;
  const flat = tickers.length - gainers - losers;

  const displayedArticles = useMemo(() => {
    if (selectedIdentifier) {
      const arts = articlesByIdentifier[selectedIdentifier] ?? [];
      return sortArticles(arts, sortMode).slice(0, 20);
    }
    const allArts = Object.values(articlesByIdentifier).flat();
    const seen = new Set<string>();
    const deduped = allArts.filter((a) => {
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });
    return sortArticles(deduped, sortMode).slice(0, 60);
  }, [selectedIdentifier, articlesByIdentifier, sortMode]);

  return (
    <AppShell pageTitle="Watchlist" mood="neutral" moodHeadline="Markets steady" moodDetails={["VIX 14.2", "S&P +0.38%"]}>
      <div className="flex gap-6 p-6 h-[calc(100vh-var(--topbar-height)-var(--moodbar-height))]">
        {/* LEFT COL */}
        <div className="w-[360px] flex-shrink-0 overflow-y-auto flex flex-col gap-5">
          <p className="font-sans text-[12px] text-text-muted">
            Track companies, tickers, and sectors. Articles matching your watchlist are boosted in relevance.
          </p>

          {/* Add form */}
          <div className="bg-white border border-border-base rounded-xl p-4">
            <div className="flex gap-2 mb-2.5">
              <Input
                value={input}
                onChange={(e) => { setInput(e.target.value); setAddError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter" && input.trim()) handleAdd(); }}
                placeholder="e.g. NVDA, Anthropic, Technology"
                className="flex-1 font-data"
              />
              <button
                type="button"
                onClick={handleAdd}
                className="px-4 py-2 rounded-lg bg-gold text-cream font-sans text-[11px] font-bold hover:bg-gold-dark transition-colors cursor-pointer flex-shrink-0"
              >
                ADD
              </button>
            </div>
            {addError && <p className="font-sans text-[11px] text-signal-dn mb-2">{addError}</p>}
            <div className="flex gap-1.5">
              {(["ticker", "company", "sector"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setAddType(t)}
                  className={cn(
                    "px-3 py-1 rounded-md font-data text-[10px] cursor-pointer transition-colors",
                    addType === t
                      ? "bg-gold-muted border border-gold-border text-gold font-semibold"
                      : "bg-parchment-mid border border-border-base text-text-muted hover:text-text-primary",
                  )}
                >
                  {t.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Quick add sectors */}
          <div>
            <p className="font-data text-[9px] uppercase tracking-widest text-text-muted mb-2">Quick Add Sector</p>
            <div className="flex flex-wrap gap-1.5">
              {INDUSTRY_VERTICALS.map((s) => {
                const isTracked = watchlist.some((e) => e.identifier.toLowerCase() === s.toLowerCase());
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => handleAddSector(s)}
                    disabled={isTracked}
                    className={cn(
                      "px-2.5 py-1 rounded-md font-data text-[10px] cursor-pointer transition-colors",
                      isTracked
                        ? "bg-parchment-mid text-text-faint border border-border-base opacity-50 cursor-default"
                        : "bg-gold-muted border border-gold-border text-gold hover:bg-gold/10",
                    )}
                  >
                    {s}{isTracked ? " \u2713" : ""}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Stats */}
          {tickers.length > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: "Watching", sub: `${watchlist.length} total`, value: watchlist.length, icon: <Star size={12} />, color: "text-gold" },
                { label: "Gainers", sub: `of ${tickers.length} tickers`, value: gainers, icon: <TrendingUp size={12} />, color: "text-signal-up" },
                { label: "Losers", sub: `of ${tickers.length} tickers`, value: losers, icon: <TrendingDown size={12} />, color: "text-signal-dn" },
                { label: "Flat", sub: `of ${tickers.length} tickers`, value: flat, icon: <Minus size={12} />, color: "text-text-muted" },
              ].map((s) => (
                <div key={s.label} className="bg-white border border-border-base rounded-xl p-3 text-center">
                  <div className={cn("flex items-center justify-center gap-1 mb-0.5", s.color)}>
                    {s.icon}
                    <span className="font-data text-[16px] font-bold">{s.value}</span>
                  </div>
                  <p className="font-data text-[9px] text-text-muted uppercase tracking-wider">{s.label}</p>
                  <p className="font-data text-[8px] text-text-faint">{s.sub}</p>
                </div>
              ))}
            </div>
          )}

          {/* Tracking list */}
          <div>
            <p className="font-data text-[9px] uppercase tracking-widest text-text-muted mb-2.5">
              Tracking ({watchlist.length})
            </p>

            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
              </div>
            ) : watchlist.length === 0 ? (
              <EmptyState
                icon={<Star size={32} />}
                title="Nothing tracked yet"
                description="Add a ticker, company, or sector above to start tracking"
              />
            ) : (
              <div className="space-y-1.5">
                {watchlist.map((entry) => {
                  const price = prices[entry.identifier];
                  const articleCount = (articlesByIdentifier[entry.identifier] ?? []).length;
                  return (
                    <div
                      key={entry.id}
                      onClick={() => setSelectedIdentifier(sel => sel === entry.identifier ? null : entry.identifier)}
                      className={cn(
                        "flex items-center gap-3 px-4 py-2.5 bg-white border border-border-base rounded-xl group cursor-pointer transition-colors",
                        selectedIdentifier === entry.identifier
                          ? "border-l-2 border-l-gold bg-gold-muted/30"
                          : "hover:border-border-hover",
                      )}
                    >
                      <span className="font-data text-[13px] font-bold text-text-primary flex-1 truncate">
                        {entry.identifier}
                      </span>

                      {articleCount > 0 && (
                        <span className="font-data text-[9px] text-gold bg-gold-muted border border-gold-border px-1.5 py-0.5 rounded-md flex-shrink-0">
                          {articleCount} art.
                        </span>
                      )}

                      {entry.type === "ticker" && price && (
                        <span className={cn("font-data text-[12px] tabular-nums flex-shrink-0", price.pct >= 0 ? "text-signal-up" : "text-signal-dn")}>
                          ${price.price} {price.pct >= 0 ? "+" : ""}{price.pct}%
                        </span>
                      )}

                      <span className="font-data text-[9px] text-gold bg-gold-muted border border-gold-border px-1.5 py-0.5 rounded-md flex-shrink-0 uppercase">
                        {entry.type}
                      </span>

                      <div
                        className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button type="button" onClick={() => setMemoEntry(entry)} className="p-1 rounded-md hover:bg-parchment-mid cursor-pointer" aria-label="Generate memo">
                          <Sparkles size={11} className="text-gold" />
                        </button>
                        {entry.type !== "sector" && (
                          <button type="button" onClick={() => router.push(`/watchlist/${encodeURIComponent(entry.identifier)}`)} className="p-1 rounded-md hover:bg-parchment-mid cursor-pointer" aria-label="Open brief">
                            <ExternalLink size={11} className="text-text-muted" />
                          </button>
                        )}
                        <button type="button" onClick={() => handleRemove(entry.id)} className="p-1 rounded-md hover:bg-parchment-mid cursor-pointer" aria-label="Remove">
                          <Trash2 size={11} className="text-text-faint hover:text-signal-dn" />
                        </button>
                      </div>

                      <ChevronRight size={10} className="text-text-faint flex-shrink-0" />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COL */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="font-data text-[9px] uppercase tracking-widest text-text-muted">
                {selectedIdentifier
                  ? `Showing: ${selectedIdentifier}`
                  : "Watchlist Feed"}
              </p>
              <p className="font-data text-[10px] text-gold font-semibold">
                {displayedArticles.length} {displayedArticles.length === 1 ? "article" : "articles"}
                {selectedIdentifier && (
                  <button onClick={() => setSelectedIdentifier(null)} className="ml-2 text-text-muted text-[9px] hover:text-text-primary cursor-pointer">
                    ← Back
                  </button>
                )}
              </p>
            </div>
            <div className="flex gap-1">
              {(["newest", "relevant"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSortMode(mode)}
                  className={cn(
                    "px-2.5 py-1 rounded-md font-data text-[9px] cursor-pointer transition-colors border",
                    sortMode === mode
                      ? "border-gold bg-gold-muted text-gold font-semibold"
                      : "border-border-base bg-white text-text-muted hover:text-text-primary",
                  )}
                >
                  {mode === "newest" ? "Newest" : "Relevant"}
                </button>
              ))}
            </div>
          </div>

          {displayedArticles.length === 0 ? (
            <EmptyState
              icon={<ExternalLink size={24} />}
              title="No matching articles yet"
              description="Recent articles matching your watchlist will appear here"
              className="py-8"
            />
          ) : (
            <div className="space-y-2">
              {displayedArticles.map((a) => (
                <div key={a.id} className="bg-white border border-border-base rounded-xl p-3">
                  <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                    {(a.industry_verticals ?? []).map((v) => (
                      <span key={v} className="font-data text-[9px] px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200">
                        {v}
                      </span>
                    ))}
                    {(a.activity_types ?? []).map((t) => (
                      <span key={t} className="font-data text-[9px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                        {t}
                      </span>
                    ))}
                    {a.source && <span className="font-data text-[9px] text-text-muted">{a.source}</span>}
                    {a.published_at && (
                      <span className="font-data text-[9px] text-text-faint ml-auto">{timeAgo(a.published_at)}</span>
                    )}
                  </div>
                  <h4 className="font-sans text-[13px] font-semibold text-espresso leading-snug">
                    {a.title}
                  </h4>
                  <div className="flex items-center justify-between mt-2">
                    <span />
                    <button
                      type="button"
                      onClick={() => setArticleMemoEntry(a)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded font-data text-[9px] text-gold bg-gold-muted border border-gold-border hover:bg-gold/10 cursor-pointer transition-colors"
                    >
                      <Sparkles size={9} />
                      Memo
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {memoEntry && (
        <MemoModal
          isOpen={true}
          onClose={() => setMemoEntry(null)}
          title={memoEntry.identifier}
          content={buildWatchlistMemoContent(memoEntry, articlesByIdentifier[memoEntry.identifier] ?? [])}
          type="company"
        />
      )}

      {articleMemoEntry && (
        <MemoModal
          isOpen={true}
          onClose={() => setArticleMemoEntry(null)}
          title={articleMemoEntry.title}
          content={`${articleMemoEntry.title}\n${articleMemoEntry.source ?? ""}`}
          type="article"
        />
      )}
    </AppShell>
  );
}

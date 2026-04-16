"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
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
  Globe,
} from "lucide-react";
import { createBrowserClient } from "@supabase/ssr";
import { MemoModal } from "@/components/memo/MemoModal";
import { WatchlistAddInput, type AddType } from "@/components/watchlist/WatchlistAddInput";
import { buildArticleOrFilter } from "@/lib/watchlist-utils";

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

// Maps UI sector labels → actual DB sector column values
// Use .in('sector', mappedValues) when present; fall back to .ilike for unmapped sectors.
const SECTOR_DB_MAPPING: Record<string, string[]> = {
  "Technology": ["Technology M&A & Investment Banking", "Technology"],
  "Healthcare & Biotech": ["Healthcare & Biotech"],
  "Energy & Oil/Gas": ["Energy & Oil/Gas"],
  "Financial Services": [
    "Financial Services",
    "Public Markets & Earnings",
    "Private Equity & Buyouts",
    "Venture Capital & Startup Funding",
  ],
  "Consumer & Retail": ["Consumer & Retail"],
  "Aerospace & Defense": ["Aerospace & Defense"],
  "Real Estate": ["Real Estate & Infrastructure", "Real Estate"],
  "Materials & Mining": ["Materials & Mining"],
  // Industrials & Manufacturing, Media & Telecom, Agriculture → ilike fallback
};

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

// LEGACY BRIDGE — used only for existing watchlist entries added before the
// display_name column existed. New entries get display_name from Finnhub on add.
// Safe to remove once all existing entries have been re-added.
const LEGACY_TICKER_NAMES: Record<string, string> = {
  NVDA: "Nvidia", NVDL: "Nvidia", AMZN: "Amazon", TSLA: "Tesla",
  AAPL: "Apple", MSFT: "Microsoft", GOOGL: "Alphabet", GOOG: "Alphabet",
  META: "Meta", IONQ: "IonQ", FCX: "Freeport-McMoRan", SPMO: "Invesco",
  "BRK.B": "Berkshire Hathaway", BRK: "Berkshire Hathaway", V: "Visa",
  BX: "Blackstone", APO: "Apollo Global", KKR: "KKR", GS: "Goldman Sachs",
  MS: "Morgan Stanley", JPM: "JPMorgan", BAC: "Bank of America",
  CG: "Carlyle", BAM: "Brookfield", CLS: "Celestica", AMD: "AMD", INTC: "Intel",
  TSM: "TSMC", BABA: "Alibaba", NFLX: "Netflix", DIS: "Disney",
  PYPL: "PayPal", COIN: "Coinbase", PLTR: "Palantir", UBER: "Uber",
};

// Converts stored uppercase sector identifiers (e.g. "FINANCIAL SERVICES")
// to canonical display casing (e.g. "Financial Services")
function toDisplayName(identifier: string): string {
  return INDUSTRY_VERTICALS.find(
    v => v.toUpperCase() === identifier.toUpperCase(),
  ) ?? identifier;
}

interface WatchlistEntry {
  id: string;
  identifier: string;
  type: string;
  display_name?: string;
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
  primary_company?: string;
  industry_verticals?: string[];
  activity_types?: string[];
  published_at?: string;
  relevance_score?: number;
  summary?: string;
  url?: string;
}

function stripHtml(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#038;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Returns true if the title is primarily ASCII/English (>80% basic Latin chars). */
function isEnglishTitle(title: string): boolean {
  if (!title) return true;
  const asciiCount = [...title].filter((c) => c.charCodeAt(0) < 256).length;
  return asciiCount / title.length > 0.8;
}

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 0) return "";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days >= 30) return "30d+ ago";
  return `${days}d ago`;
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

function mapCachedArticle(a: Record<string, unknown>): MatchedArticle {
  return {
    id: a.article_id as string,
    title: a.title as string,
    source: a.source as string | undefined,
    sector: undefined,
    primary_company: undefined,
    industry_verticals: [],
    activity_types: [],
    published_at: a.published_at as string | undefined,
    relevance_score: (a.relevance_score as number | null) ?? 5,
    summary: stripHtml(a.summary as string | null | undefined) || undefined,
    url: a.url as string | undefined,
  };
}

function mapArticle(a: Record<string, unknown>): MatchedArticle {
  return {
    id: a.id as string,
    title: a.title as string,
    source: a.source as string | undefined,
    sector: a.sector as string | undefined,
    primary_company: a.primary_company as string | undefined,
    industry_verticals: (a.industry_verticals as string[] | null) ?? [],
    activity_types: (a.activity_types as string[] | null) ?? [],
    published_at: (a.published_at as string | null) || (a.ingested_at as string | null) || undefined,
    relevance_score: (a.relevance_score as number | null) ?? 0,
    summary: stripHtml(a.summary as string | null | undefined) || undefined,
    url: a.url as string | undefined,
  };
}

function dedupeAndSort(rows: MatchedArticle[]): MatchedArticle[] {
  const seen = new Set<string>();
  const out: MatchedArticle[] = [];
  for (const a of rows) {
    if (!seen.has(a.id)) { seen.add(a.id); out.push(a); }
  }
  out.sort((a, b) =>
    new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime(),
  );
  return out.slice(0, 20);
}

async function fetchCachedArticles(identifier: string): Promise<MatchedArticle[]> {
  try {
    const res = await fetch(
      `/api/watchlist-articles?identifier=${encodeURIComponent(identifier)}`,
      { signal: AbortSignal.timeout(4000) },
    );
    if (!res.ok) return [];
    const json = await res.json();
    if (!Array.isArray(json.articles)) return [];
    return json.articles.map(mapCachedArticle);
  } catch {
    return [];
  }
}

async function fetchArticlesForEntry(entry: WatchlistEntry): Promise<MatchedArticle[]> {
  const baseSelect = "id, title, source, sector, primary_company, industry_verticals, activity_types, published_at, ingested_at, relevance_score, summary, url";

  if (entry.type === "sector") {
    const canonicalVertical = toDisplayName(entry.identifier);
    const dbSectors = SECTOR_DB_MAPPING[canonicalVertical];

    let sectorQuery;
    if (dbSectors && dbSectors.length > 0) {
      sectorQuery = getSupabase().from("articles").select(baseSelect)
        .in("sector", dbSectors)
        .order("ingested_at", { ascending: false }).limit(30);
    } else {
      sectorQuery = getSupabase().from("articles").select(baseSelect)
        .ilike("sector", `%${canonicalVertical}%`)
        .order("ingested_at", { ascending: false }).limit(30);
    }

    const { data } = await sectorQuery;
    return dedupeAndSort((data || []).map(mapArticle));
  }

  // Cache-first: use pre-fetched watchlist_articles if entry is older than 60 minutes.
  // Skip cache for sector entries (handled above) and entries added < 60 min ago (no sync yet).
  const createdAt = entry.created_at ? new Date(entry.created_at).getTime() : null;
  const entryAgeMs = createdAt !== null ? Date.now() - createdAt : 0;
  const SIXTY_MIN_MS = 60 * 60 * 1000;

  if (entryAgeMs >= SIXTY_MIN_MS) {
    const cached = await fetchCachedArticles(entry.identifier);
    if (cached.length > 0) {
      return dedupeAndSort(cached);
    }
    // Cache miss — fall through to live fetches below
  }

  // ticker or company — use fuzzy suffix-stripping to build a multi-term OR query.
  // Priority for display name: 1) stored display_name  2) legacy bridge  3) raw identifier
  const displayNameForSearch: string | null =
    entry.type === "company"
      ? null // company identifiers are already the human-readable name
      : (entry.display_name ?? LEGACY_TICKER_NAMES[entry.identifier.toUpperCase()] ?? null);

  const orFilter = buildArticleOrFilter(entry.identifier, displayNameForSearch, entry.type);
  if (!orFilter) return [];

  const { data } = await getSupabase()
    .from("articles")
    .select(baseSelect)
    .or(orFilter)
    .order("ingested_at", { ascending: false })
    .limit(30);

  const result = dedupeAndSort((data || []).map(mapArticle));

  if (entry.type === "company" && entry.identifier.length < 6) {
    return result.filter(a =>
      a.primary_company?.toLowerCase().includes(entry.identifier.toLowerCase())
    );
  }

  if (result.length === 0 && entry.type === "ticker") {
    try {
      const res = await fetch(`/api/finnhub-news?symbol=${encodeURIComponent(entry.identifier)}`);
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.articles) && json.articles.length > 0) {
          return dedupeAndSort(json.articles.map(mapArticle));
        }
      }
    } catch {
      // silent fallback failure — return empty
    }
  }

  // GDELT fallback for company entries with sparse coverage
  if (entry.type === "company" && result.length < 3) {
    try {
      const searchName = entry.display_name || entry.identifier;
      const gdeltRes = await fetch(`/api/news-search?q=${encodeURIComponent(searchName)}`, { signal: AbortSignal.timeout(6000) });
      if (gdeltRes.ok) {
        const gdeltJson = await gdeltRes.json();
        if (Array.isArray(gdeltJson.articles) && gdeltJson.articles.length > 0) {
          const gdeltArticles = gdeltJson.articles.map(mapArticle);
          return dedupeAndSort([...result, ...gdeltArticles]);
        }
      }
    } catch {
      // silent fallback failure
    }
  }

  return result;
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

function cleanDisplayName(name: string | null | undefined): string | null {
  if (!name) return null;
  return name
    .replace(/\s*-\s*CL\s+[A-Z]\s*$/i, "")
    .replace(/\s+INC-CL\s+[A-Z]\s*$/i, "")
    .replace(/\s+-\s*Class\s+[A-Z]\s*$/i, "")
    .replace(/\s+Class\s+[A-Z]\s+Shares?\s*$/i, "")
    .trim() || null;
}

export default function WatchlistPage() {
  const router = useRouter();
  const [memoEntry, setMemoEntry] = useState<WatchlistEntry | null>(null);
  const [articleMemoEntry, setArticleMemoEntry] = useState<MatchedArticle | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [prices, setPrices] = useState<Record<string, WatchlistPrice>>({});
  const [articlesByIdentifier, setArticlesByIdentifier] = useState<Record<string, MatchedArticle[]>>({});
  const [loading, setLoading] = useState(true);
  const [addType, setAddType] = useState<AddType>("ticker");
  const [addError, setAddError] = useState("");
  const [selectedIdentifier, setSelectedIdentifier] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<"newest" | "relevant">("newest");
  const [ageFilter, setAgeFilter] = useState<"all" | "today" | "week" | "month">("all");

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

  const handleAdd = async (identifier: string, displayName?: string) => {
    if (!identifier.trim()) {
      if (addType === "company") {
        setAddError("Please enter a company name (at least 2 characters)");
      } else {
        setAddError("Please select a ticker from the dropdown");
      }
      return;
    }
    if (addType === "company" && identifier.trim().length < 2) {
      setAddError("Company name must be at least 2 characters");
      return;
    }
    setAddError("");
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: identifier.trim(),
          type: addType,
          ...(displayName ? { display_name: displayName } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json();
        setAddError(body.error || "Failed to add");
        return;
      }
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
    await handleAdd(sectorName);
  };

  const tickers = watchlist.filter((e) => e.type === "ticker");
  const gainers = tickers.filter((e) => prices[e.identifier]?.pct > 0).length;
  const losers = tickers.filter((e) => prices[e.identifier]?.pct < 0).length;
  const flat = tickers.length - gainers - losers;

  const sectorEntries = watchlist.filter((e) => e.type === "sector");
  const nonSectorEntries = watchlist.filter((e) => e.type !== "sector");
  const showDivider = sectorEntries.length > 0 && nonSectorEntries.length > 0;

  const publicEntries = nonSectorEntries.filter((e) => e.type === "ticker");
  const privateEntries = nonSectorEntries.filter((e) => e.type === "company");

  const selectedEntry = watchlist.find(e => e.identifier === selectedIdentifier);
  const selectedDisplayLabel = selectedIdentifier
    ? (selectedEntry?.type === "sector"
        ? toDisplayName(selectedIdentifier)
        : (selectedEntry?.display_name ?? LEGACY_TICKER_NAMES[selectedIdentifier.toUpperCase()] ?? selectedIdentifier))
    : null;

  const displayedArticles = useMemo(() => {
    const now = Date.now();
    const AGE_WINDOWS: Record<string, number> = {
      today: 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000,
      month: 30 * 24 * 60 * 60 * 1000,
    };

    function applyAgeFilter(articles: MatchedArticle[]): MatchedArticle[] {
      if (ageFilter === "all") return articles;
      const window = AGE_WINDOWS[ageFilter];
      return articles.filter((a) => {
        if (!a.published_at) return false;
        return now - new Date(a.published_at).getTime() <= window;
      });
    }

    function normalizeKey(a: MatchedArticle): string {
      const t = (a.title ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const u = a.url ?? "";
      return `${t}||${u}`;
    }

    if (selectedIdentifier) {
      const arts = applyAgeFilter(
        (articlesByIdentifier[selectedIdentifier] ?? []).filter((a) => isEnglishTitle(a.title)),
      );
      return sortArticles(arts, sortMode).slice(0, 20);
    }

    const allArts = Object.values(articlesByIdentifier).flat();
    const seenId = new Set<string>();
    const seenKey = new Set<string>();
    const deduped = allArts.filter((a) => {
      if (seenId.has(a.id)) return false;
      seenId.add(a.id);
      const key = normalizeKey(a);
      if (seenKey.has(key)) return false;
      seenKey.add(key);
      return true;
    });

    return sortArticles(
      applyAgeFilter(deduped.filter((a) => isEnglishTitle(a.title))),
      sortMode,
    ).slice(0, 60);
  }, [selectedIdentifier, articlesByIdentifier, sortMode, ageFilter]);

  return (
    <AppShell pageTitle="Watchlist" mood="neutral" moodHeadline="Markets steady" moodDetails={["VIX 14.2", "S&P +0.38%"]}>
      <div className="flex gap-6 p-6 h-[calc(100vh-var(--topbar-height)-var(--moodbar-height))]">
        {/* LEFT COL */}
        <div className="w-[360px] flex-shrink-0 overflow-y-auto flex flex-col gap-5">
          <p className="font-sans text-[12px] text-text-muted">
            Track companies, tickers, and sectors. Articles matching your watchlist are boosted in relevance.
          </p>

          {/* Add form with autocomplete */}
          <WatchlistAddInput
            addType={addType}
            onAddTypeChange={setAddType}
            onAdd={handleAdd}
            addError={addError}
            onClearError={() => setAddError("")}
            trackedIdentifiers={watchlist.map((e) => e.identifier)}
          />

          {/* Stats */}
          {tickers.length > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: "TRACKING", sub: `${watchlist.length} items`, value: watchlist.length, icon: <Star size={12} />, color: "text-gold" },
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
                {/* SECTOR GROUP */}
                {sectorEntries.length > 0 && (
                  <>
                    {showDivider && (
                      <p className="font-data text-[8px] uppercase tracking-widest text-text-faint mb-1.5">Sectors</p>
                    )}
                    {sectorEntries.map((entry) => {
                      const articleCount = (articlesByIdentifier[entry.identifier] ?? []).length;
                      return (
                        <div
                          key={entry.id}
                          onClick={() => setSelectedIdentifier(sel => sel === entry.identifier ? null : entry.identifier)}
                          className={cn(
                            "flex items-center justify-between gap-3 px-4 py-3 border border-border-base rounded-xl group cursor-pointer transition-colors",
                            selectedIdentifier === entry.identifier
                              ? "border-l-2 border-l-gold bg-gold-muted/30"
                              : "bg-parchment-mid hover:border-border-hover",
                          )}
                        >
                          {/* Sector name — full width, no fixed constraint */}
                          <span className="font-data text-[12px] font-bold text-text-primary truncate min-w-0 flex-1">
                            {toDisplayName(entry.identifier)}
                          </span>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {articleCount > 0 && (
                              <span className="font-data text-[9px] text-text-faint bg-parchment-mid border border-border-base px-1.5 py-0.5 rounded-md">
                                {articleCount >= 20 ? "20+" : articleCount}
                              </span>
                            )}
                            <div
                              className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button type="button" onClick={() => setMemoEntry(entry)} className="p-1 rounded-md hover:bg-parchment-mid cursor-pointer" aria-label="Generate memo">
                                <Sparkles size={11} className="text-gold" />
                              </button>
                              <button type="button" onClick={() => handleRemove(entry.id)} className="p-1 rounded-md hover:bg-parchment-mid cursor-pointer" aria-label="Remove">
                                <Trash2 size={11} className="text-text-faint hover:text-signal-dn" />
                              </button>
                            </div>
                            <Globe size={10} className="text-text-faint" />
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}

                {/* DIVIDER */}
                {showDivider && (
                  <div className="flex items-center gap-2 my-2">
                    <div className="flex-1 h-px bg-border-base" />
                    <div className="flex-1 h-px bg-border-base" />
                  </div>
                )}

                {/* PUBLIC COMPANIES GROUP */}
                {publicEntries.length > 0 && (
                  <>
                    <p className="font-data text-[8px] uppercase tracking-widest text-text-faint mb-1.5 mt-1">Public Companies</p>
                    {publicEntries.map((entry) => {
                      const price = prices[entry.identifier];
                      const articleCount = (articlesByIdentifier[entry.identifier] ?? []).length;
                      const subtitle = cleanDisplayName(entry.display_name ?? LEGACY_TICKER_NAMES[entry.identifier.toUpperCase()]);
                      return (
                        <div
                          key={entry.id}
                          onClick={() => setSelectedIdentifier(sel => sel === entry.identifier ? null : entry.identifier)}
                          className={cn(
                            "flex gap-3 px-4 py-3 border border-border-base rounded-xl group cursor-pointer transition-colors",
                            "items-start",
                            "min-h-[56px]",
                            selectedIdentifier === entry.identifier
                              ? "border-l-2 border-l-gold bg-gold-muted/30"
                              : "bg-white hover:border-border-hover",
                          )}
                        >
                          {/* LEFT: identifier + optional display_name subtitle */}
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className="font-data text-[13px] font-bold text-text-primary truncate">
                              {entry.identifier}
                            </span>
                            {subtitle && (
                              <span className="font-data text-[9px] text-text-faint">
                                {subtitle}
                              </span>
                            )}
                          </div>

                          {/* RIGHT: article count, price, hover actions, chevron */}
                          <div className="flex items-center gap-2 flex-shrink-0 self-center">
                            {articleCount > 0 && (
                              <span className="font-data text-[9px] text-text-faint bg-parchment-mid border border-border-base px-1.5 py-0.5 rounded-md">
                                {articleCount >= 20 ? "20+" : articleCount}
                              </span>
                            )}
                            {entry.type === "ticker" && price && (
                              <span className={cn("font-data text-[11px] tabular-nums", price.pct >= 0 ? "text-signal-up" : "text-signal-dn")}>
                                ${price.price} <span className="text-[10px]">{price.pct >= 0 ? "+" : ""}{price.pct}%</span>
                              </span>
                            )}
                            <div
                              className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button type="button" onClick={() => setMemoEntry(entry)} className="p-1 rounded-md hover:bg-parchment-mid cursor-pointer" aria-label="Generate memo">
                                <Sparkles size={11} className="text-gold" />
                              </button>
                              <button type="button" onClick={() => router.push(`/watchlist/${encodeURIComponent(entry.identifier)}`)} className="p-1 rounded-md hover:bg-parchment-mid cursor-pointer" aria-label="Open brief">
                                <ExternalLink size={11} className="text-text-muted" />
                              </button>
                              <button type="button" onClick={() => handleRemove(entry.id)} className="p-1 rounded-md hover:bg-parchment-mid cursor-pointer" aria-label="Remove">
                                <Trash2 size={11} className="text-text-faint hover:text-signal-dn" />
                              </button>
                            </div>
                            <ChevronRight size={10} className="text-text-faint" />
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}

                {/* PRIVATE COMPANIES GROUP */}
                {privateEntries.length > 0 && (
                  <>
                    <p className="font-data text-[8px] uppercase tracking-widest text-text-faint mb-1.5 mt-1">Private Companies</p>
                    {privateEntries.map((entry) => {
                      const price = prices[entry.identifier];
                      const articleCount = (articlesByIdentifier[entry.identifier] ?? []).length;
                      const subtitle = cleanDisplayName(entry.display_name ?? LEGACY_TICKER_NAMES[entry.identifier.toUpperCase()]);
                      return (
                        <div
                          key={entry.id}
                          onClick={() => setSelectedIdentifier(sel => sel === entry.identifier ? null : entry.identifier)}
                          className={cn(
                            "flex gap-3 px-4 py-3 border border-border-base rounded-xl group cursor-pointer transition-colors",
                            "items-start",
                            "min-h-[56px]",
                            selectedIdentifier === entry.identifier
                              ? "border-l-2 border-l-gold bg-gold-muted/30"
                              : "bg-white hover:border-border-hover",
                          )}
                        >
                          {/* LEFT: identifier + optional display_name subtitle */}
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className="font-data text-[13px] font-bold text-text-primary truncate">
                              {entry.identifier}
                            </span>
                            {subtitle && (
                              <span className="font-data text-[9px] text-text-faint">
                                {subtitle}
                              </span>
                            )}
                          </div>

                          {/* RIGHT: article count, price, hover actions, chevron */}
                          <div className="flex items-center gap-2 flex-shrink-0 self-center">
                            {articleCount > 0 && (
                              <span className="font-data text-[9px] text-text-faint bg-parchment-mid border border-border-base px-1.5 py-0.5 rounded-md">
                                {articleCount >= 20 ? "20+" : articleCount}
                              </span>
                            )}
                            {entry.type === "ticker" && price && (
                              <span className={cn("font-data text-[11px] tabular-nums", price.pct >= 0 ? "text-signal-up" : "text-signal-dn")}>
                                ${price.price} <span className="text-[10px]">{price.pct >= 0 ? "+" : ""}{price.pct}%</span>
                              </span>
                            )}
                            <div
                              className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button type="button" onClick={() => setMemoEntry(entry)} className="p-1 rounded-md hover:bg-parchment-mid cursor-pointer" aria-label="Generate memo">
                                <Sparkles size={11} className="text-gold" />
                              </button>
                              <button type="button" onClick={() => router.push(`/watchlist/${encodeURIComponent(entry.identifier)}`)} className="p-1 rounded-md hover:bg-parchment-mid cursor-pointer" aria-label="Open brief">
                                <ExternalLink size={11} className="text-text-muted" />
                              </button>
                              <button type="button" onClick={() => handleRemove(entry.id)} className="p-1 rounded-md hover:bg-parchment-mid cursor-pointer" aria-label="Remove">
                                <Trash2 size={11} className="text-text-faint hover:text-signal-dn" />
                              </button>
                            </div>
                            <ChevronRight size={10} className="text-text-faint" />
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COL */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            {selectedIdentifier ? (
              <div className="flex items-center gap-2">
                <span className="font-display text-[15px] font-bold text-espresso">{selectedDisplayLabel}</span>
                <span className="font-data text-[9px] text-text-faint">{displayedArticles.length} articles</span>
                <button onClick={() => setSelectedIdentifier(null)} className="font-data text-[9px] text-text-muted hover:text-text-primary cursor-pointer ml-1">← All</button>
              </div>
            ) : (
              <div>
                <p className="font-data text-[9px] uppercase tracking-widest text-text-muted">Watchlist Feed</p>
                <p className="font-data text-[11px] text-gold font-semibold">{displayedArticles.length} articles</p>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              {(["all", "today", "week", "month"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setAgeFilter(f)}
                  className={cn(
                    "px-2.5 py-1 rounded-md font-data text-[9px] cursor-pointer transition-colors border",
                    ageFilter === f
                      ? "border-gold bg-gold-muted text-gold font-semibold"
                      : "border-border-base bg-white text-text-muted hover:text-text-primary",
                  )}
                >
                  {f === "all" ? "All" : f === "today" ? "Today" : f === "week" ? "This Week" : "This Month"}
                </button>
              ))}
              <div className="w-px h-4 bg-border-base mx-0.5" />
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
            (() => {
              if (watchlist.length === 0) {
                return (
                  <div className="bg-parchment-mid border border-border-base rounded-xl p-5 text-center">
                    <p className="font-sans text-[13px] font-semibold text-text-primary mb-1">Your feed is empty</p>
                    <p className="font-sans text-[12px] text-text-secondary">
                      Add tickers, companies, or sectors in the left panel to start tracking articles.
                    </p>
                  </div>
                );
              }
              if (selectedIdentifier) {
                const entry = watchlist.find(e => e.identifier === selectedIdentifier);
                const entryAgeMs = entry?.created_at ? Date.now() - new Date(entry.created_at).getTime() : Infinity;
                const ONE_HOUR_MS = 60 * 60 * 1000;
                if (entryAgeMs < ONE_HOUR_MS) {
                  return (
                    <div className="bg-parchment-mid border border-border-base rounded-xl p-5">
                      <p className="font-sans text-[13px] font-semibold text-text-primary mb-1">Syncing…</p>
                      <p className="font-sans text-[12px] text-text-secondary">
                        Articles will appear after the next pipeline run (6am / 8pm PST).
                      </p>
                    </div>
                  );
                }
                if (entry?.type === "company") {
                  const name = entry.display_name || entry.identifier;
                  return (
                    <div className="bg-parchment-mid border border-border-base rounded-xl p-5">
                      <p className="font-sans text-[13px] font-semibold text-text-primary mb-1">No recent coverage found for {name}</p>
                      <p className="font-sans text-[12px] text-text-secondary">
                        We search Exa, Finnhub, and GDELT twice daily.
                      </p>
                    </div>
                  );
                }
                if (entry?.type === "ticker") {
                  return (
                    <div className="bg-parchment-mid border border-border-base rounded-xl p-5">
                      <p className="font-sans text-[13px] font-semibold text-text-primary mb-1">No recent coverage found for {selectedIdentifier}</p>
                      <p className="font-sans text-[12px] text-text-secondary">
                        Try checking back after the next sync.
                      </p>
                    </div>
                  );
                }
              }
              return (
                <div className="bg-parchment-mid border border-border-base rounded-xl p-5">
                  <p className="font-sans text-[13px] font-semibold text-text-primary mb-1">No matching articles found</p>
                  <p className="font-sans text-[12px] text-text-secondary">
                    Articles are ingested every morning and evening. Your watchlist feed will populate as matching coverage arrives.
                  </p>
                </div>
              );
            })()
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
                    {a.id.startsWith("finnhub-") && (
                      <span className="font-data text-[9px] text-text-faint">via Finnhub</span>
                    )}
                    {a.published_at && timeAgo(a.published_at) && (
                      <span className="font-data text-[9px] text-text-faint ml-auto">{timeAgo(a.published_at)}</span>
                    )}
                    <button
                      type="button"
                      onClick={() => setArticleMemoEntry(a)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded font-data text-[9px] text-gold bg-gold-muted border border-gold-border hover:bg-gold/10 cursor-pointer transition-colors"
                    >
                      <Sparkles size={9} />
                      Memo
                    </button>
                  </div>
                  {a.url ? (
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block hover:opacity-80 transition-opacity"
                    >
                      <h4 className="font-sans text-[13px] font-semibold text-espresso leading-snug">
                        {a.title}
                      </h4>
                      {(!a.summary || a.summary.trim().length < 15) ? (
                        <span className="font-data text-[9px] text-text-faint italic mt-0.5 block">
                          Headline only
                        </span>
                      ) : (
                        <p className="font-sans text-[11px] text-text-secondary leading-snug mt-1 line-clamp-2">
                          {a.summary}
                        </p>
                      )}
                    </a>
                  ) : (
                    <div>
                      <h4 className="font-sans text-[13px] font-semibold text-espresso leading-snug">
                        {a.title}
                      </h4>
                      {(!a.summary || a.summary.trim().length < 15) ? (
                        <span className="font-data text-[9px] text-text-faint italic mt-0.5 block">
                          Headline only
                        </span>
                      ) : (
                        <p className="font-sans text-[11px] text-text-secondary leading-snug mt-1 line-clamp-2">
                          {a.summary}
                        </p>
                      )}
                    </div>
                  )}
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

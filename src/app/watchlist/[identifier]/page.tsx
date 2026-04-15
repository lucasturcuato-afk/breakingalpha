"use client";

import { use, useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { ArrowLeft, Sparkles, ExternalLink, RefreshCw } from "lucide-react";
import { createBrowserClient } from "@supabase/ssr";
import { MemoModal } from "@/components/memo/MemoModal";

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

const INDUSTRY_VERTICAL_NAMES = [
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
];

// Maps UI sector labels → actual DB sector column values
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
  CG: "Carlyle", BAM: "Brookfield", AMD: "AMD", INTC: "Intel",
  TSM: "TSMC", BABA: "Alibaba", NFLX: "Netflix", DIS: "Disney",
  PYPL: "PayPal", COIN: "Coinbase", PLTR: "Palantir", UBER: "Uber",
};

interface WatchlistArticle {
  id: string;
  title: string;
  source?: string;
  url?: string;
  industry_verticals?: string[];
  activity_types?: string[];
  published_at?: string;
  summary?: string;
  relevance_score?: number;
}

/** Returns true if the title is primarily ASCII/English (>80% basic Latin chars). */
function isEnglishTitle(title: string): boolean {
  if (!title) return true;
  const asciiCount = [...title].filter((c) => c.charCodeAt(0) < 256).length;
  return asciiCount / title.length > 0.8;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function sortArticles(articles: WatchlistArticle[], mode: "newest" | "relevant"): WatchlistArticle[] {
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

export default function WatchlistIdentifierPage({
  params,
}: {
  params: Promise<{ identifier: string }>;
}) {
  const { identifier } = use(params);
  const decoded = decodeURIComponent(identifier);
  const ident = decoded.toLowerCase();
  const isSector = INDUSTRY_VERTICAL_NAMES.some(
    (v) => v.toLowerCase() === ident,
  );

  const router = useRouter();
  const [quote, setQuote] = useState<{ price: string; pct: number } | null>(
    null,
  );
  const [articles, setArticles] = useState<WatchlistArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [memoOpen, setMemoOpen] = useState(false);
  const [articleMemoEntry, setArticleMemoEntry] =
    useState<WatchlistArticle | null>(null);
  const [sortMode, setSortMode] = useState<"newest" | "relevant">("newest");
  const [briefGeneratedAt, setBriefGeneratedAt] = useState<Date | null>(null);
  const [quoteRefreshing, setQuoteRefreshing] = useState(false);
  const [storedDisplayName, setStoredDisplayName] = useState<string | null>(null);

  const refreshQuote = async () => {
    if (isSector) return;
    setQuoteRefreshing(true);
    try {
      const r = await fetch(`/api/watchlist-quotes?symbols=${decoded}`);
      const d = await r.json();
      setQuote(d.quotes?.[decoded] ?? null);
    } catch { /* ignore */ } finally {
      setQuoteRefreshing(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Fetch display_name from watchlist table (used for article search resolution)
      const { data: watchlistRow } = await getSupabase()
        .from("watchlist")
        .select("display_name, type")
        .ilike("identifier", decoded)
        .maybeSingle();

      const storedDN = watchlistRow?.display_name ?? null;
      if (!cancelled) setStoredDisplayName(storedDN);

      // Canonical sector name (normalizes URL-decoded value to proper casing)
      const canonicalVertical = INDUSTRY_VERTICAL_NAMES.find(
        v => v.toLowerCase() === ident,
      ) ?? decoded;

      // Resolve human-readable name for article queries
      // Priority: 1) stored display_name  2) legacy bridge  3) raw identifier
      const resolvedName = isSector
        ? canonicalVertical
        : (storedDN ?? LEGACY_TICKER_NAMES[decoded.toUpperCase()] ?? decoded);

      const hasAlias = resolvedName.toLowerCase() !== decoded.toLowerCase();

      const quotePromise = !isSector
        ? fetch(`/api/watchlist-quotes?symbols=${decoded}`)
            .then((r) => r.json())
            .then((d) => d.quotes?.[decoded] ?? null)
            .catch(() => null)
        : Promise.resolve(null);

      const articleSelect = "id, title, source, url, primary_company, industry_verticals, activity_types, published_at, ingested_at, summary, relevance_score";

      const mapRow = (a: Record<string, unknown>): WatchlistArticle => ({
        id: a.id as string,
        title: a.title as string,
        source: a.source as string | undefined,
        url: a.url as string | undefined,
        industry_verticals: (a.industry_verticals as string[] | null) ?? [],
        activity_types: (a.activity_types as string[] | null) ?? [],
        published_at: (a.published_at as string | null) || (a.ingested_at as string | null) || undefined,
        summary: a.summary as string | undefined,
        relevance_score: (a.relevance_score as number | null) ?? 0,
      });

      if (isSector) {
        const dbSectors = SECTOR_DB_MAPPING[canonicalVertical];
        const sectorQueryPromise = dbSectors && dbSectors.length > 0
          ? getSupabase().from("articles").select(articleSelect)
              .in("sector", dbSectors)
              .order("ingested_at", { ascending: false }).limit(30)
          : getSupabase().from("articles").select(articleSelect)
              .ilike("sector", `%${canonicalVertical}%`)
              .order("ingested_at", { ascending: false }).limit(30);

        const [quoteResult, sectorResult] = await Promise.all([
          quotePromise,
          sectorQueryPromise,
        ]);

        if (cancelled) return;

        setQuote(quoteResult);

        const merged = (sectorResult.data || []).map(mapRow).filter((a) => isEnglishTitle(a.title));
        merged.sort((a, b) =>
          new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime(),
        );
        setArticles(merged.slice(0, 20));
        setLoading(false);
      } else {
        const rawIdent = decoded.replace(/[^A-Z0-9]/gi, "");
        const skipRaw = rawIdent.length <= 1;
        const doTitleTickerMatch = rawIdent.length >= 3;

        // Primary queries — search by resolved company name (most precise)
        const nameQueries = [
          getSupabase().from("articles").select(articleSelect)
            .ilike("primary_company", `%${resolvedName}%`)
            .order("ingested_at", { ascending: false }).limit(20),
          getSupabase().from("articles").select(articleSelect)
            .ilike("companies", `%${resolvedName}%`)
            .order("ingested_at", { ascending: false }).limit(20),
          getSupabase().from("articles").select(articleSelect)
            .ilike("title", `%${resolvedName}%`)
            .order("ingested_at", { ascending: false }).limit(20),
        ];

        // Raw ticker title match (only for 3+ char tickers when there's an alias)
        const rawQueries = (!skipRaw && hasAlias && doTitleTickerMatch) ? [
          getSupabase().from("articles").select(articleSelect)
            .ilike("title", `%${decoded}%`)
            .order("ingested_at", { ascending: false }).limit(15),
        ] : [];

        const [quoteResult, ...articleResults] = await Promise.all([
          quotePromise,
          ...[...nameQueries, ...rawQueries].map((q) =>
            Promise.allSettled([q]).then((r) => r[0]),
          ),
        ]);

        if (cancelled) return;

        setQuote(quoteResult);

        const seen = new Set<string>();
        const merged: WatchlistArticle[] = [];
        articleResults.forEach((r) => {
          if (!r || (r as PromiseSettledResult<{ data: Record<string, unknown>[] | null }>).status !== "fulfilled") return;
          const fulfilled = r as PromiseFulfilledResult<{ data: Record<string, unknown>[] | null }>;
          if (!fulfilled.value.data) return;
          fulfilled.value.data.forEach((a: Record<string, unknown>) => {
            if (seen.has(a.id as string)) return;
            seen.add(a.id as string);
            merged.push({
              id: a.id as string,
              title: a.title as string,
              source: a.source as string | undefined,
              url: a.url as string | undefined,
              industry_verticals: (a.industry_verticals as string[] | null) ?? [],
              activity_types: (a.activity_types as string[] | null) ?? [],
              published_at: (a.published_at as string | null) || (a.ingested_at as string | null) || undefined,
              summary: a.summary as string | undefined,
              relevance_score: (a.relevance_score as number | null) ?? 0,
            });
          });
        });

        merged.sort((a, b) =>
          new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime(),
        );
        const finalArticles = merged.filter((a) => isEnglishTitle(a.title)).slice(0, 20);

        // Fallback: if still empty, fetch recent 50 globally and filter client-side
        if (finalArticles.length === 0) {
          const { data: fallback } = await getSupabase().from("articles")
            .select("id, title, source, url, industry_verticals, activity_types, published_at, ingested_at, summary, relevance_score, companies")
            .order("ingested_at", { ascending: false })
            .limit(50);

          if (cancelled) return;

          const resolvedLC = resolvedName.toLowerCase();
          const decodedLC = decoded.toLowerCase();
          const fallbackFiltered = (fallback || [])
            .filter((a: Record<string, unknown>) => {
              const title = (a.title as string) || "";
              if (!isEnglishTitle(title)) return false;
              const t = title.toLowerCase();
              const s = ((a.summary as string) || "").toLowerCase();
              const c = ((a.companies as string) || "").toLowerCase();
              return t.includes(resolvedLC) || t.includes(decodedLC) ||
                     s.includes(resolvedLC) || s.includes(decodedLC) ||
                     c.includes(resolvedLC) || c.includes(decodedLC);
            })
            .map((a: Record<string, unknown>) => ({
              id: a.id as string,
              title: a.title as string,
              source: a.source as string | undefined,
              url: a.url as string | undefined,
              industry_verticals: (a.industry_verticals as string[] | null) ?? [],
              activity_types: (a.activity_types as string[] | null) ?? [],
              published_at: (a.published_at as string | null) || (a.ingested_at as string | null) || undefined,
              summary: a.summary as string | undefined,
              relevance_score: (a.relevance_score as number | null) ?? 0,
            }))
            .slice(0, 20);

          setArticles(fallbackFiltered);
          setLoading(false);
          return;
        }

        setArticles(finalArticles);
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [decoded, isSector]);

  const companyName = storedDisplayName ?? LEGACY_TICKER_NAMES[decoded.toUpperCase()] ?? decoded;

  const systemPrompt = useMemo(
    () =>
      `You are a senior equity research analyst. Generate a concise, high-signal company brief in professional markdown. Use ## for section headers. Be specific — cite actual numbers, names, and dates from the provided articles. Do not use filler language.`,
    [],
  );

  const typeLabel = isSector
    ? "sector"
    : decoded === decoded.toUpperCase() && decoded.length <= 5
      ? "ticker"
      : "company";

  const briefContent = useMemo(() => {
    return `Ticker/Company: ${decoded}${companyName !== decoded ? ` (${companyName})` : ""}
Type: ${typeLabel}
${quote ? `Current Price: $${quote.price} (${quote.pct >= 0 ? "+" : ""}${quote.pct}%)` : "Price: N/A"}

Recent articles (${articles.length} total):
${articles
  .slice(0, 10)
  .map(
    (a) =>
      `- ${a.title} (${a.source ?? "unknown"}, ${a.published_at ? timeAgo(a.published_at) : "unknown date"})${a.summary ? "\n  Summary: " + a.summary.slice(0, 150) : ""}`,
  )
  .join("\n")}

Generate a professional company brief covering: current price action and what's driving it, company overview and positioning, recent developments from the articles above, upcoming catalysts to watch, and key risks. Format with clear sections.`;
  }, [decoded, companyName, typeLabel, quote, articles]);

  return (
    <AppShell
      pageTitle={decoded}
      mood="neutral"
      moodHeadline="Markets steady"
      moodDetails={["VIX 14.2", "S&P +0.38%"]}
    >
      <div className="p-6 max-w-[1100px]">
        {/* Back button */}
        <button
          type="button"
          onClick={() => router.push("/watchlist")}
          className="inline-flex items-center gap-1.5 font-data text-[11px] text-text-muted hover:text-text-primary cursor-pointer transition-colors"
        >
          <ArrowLeft size={14} /> Watchlist
        </button>

        {/* Price section (non-sector) */}
        {!isSector && (
          <div className={cn(
            "bg-white border border-border-base rounded-xl p-4 border-l-4 mt-4",
            quote ? (quote.pct >= 0 ? "border-l-signal-up" : "border-l-signal-dn") : "border-l-border-base"
          )}>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="font-display text-[28px] font-extrabold text-espresso">{decoded}</h1>
              <span className="font-data text-[10px] text-gold bg-gold-muted border border-gold-border px-2 py-0.5 rounded-md uppercase">{typeLabel}</span>
            </div>
            {(storedDisplayName ?? LEGACY_TICKER_NAMES[decoded.toUpperCase()]) && (
              <p className="font-data text-[12px] text-text-muted mt-0.5">
                {storedDisplayName ?? LEGACY_TICKER_NAMES[decoded.toUpperCase()]}
              </p>
            )}
            {quote ? (
              <div className="flex items-center gap-3">
                <span className="font-data text-[24px] font-bold text-espresso">${quote.price}</span>
                <span className={cn("font-data text-[16px] font-semibold", quote.pct >= 0 ? "text-signal-up" : "text-signal-dn")}>
                  {quote.pct >= 0 ? "+" : ""}{quote.pct}%
                </span>
                <span className="font-data text-[10px] text-text-faint">as of market close</span>
                <button type="button" onClick={refreshQuote} disabled={quoteRefreshing} className="ml-auto p-1 rounded hover:bg-parchment-mid cursor-pointer disabled:opacity-50">
                  <RefreshCw size={11} className={cn("text-text-muted", quoteRefreshing && "animate-spin")} />
                </button>
              </div>
            ) : (
              !loading && <span className="font-data text-[13px] text-text-faint">Price unavailable</span>
            )}
          </div>
        )}
        {isSector && (
          <div className="mt-4 flex items-center gap-3">
            <h1 className="font-display text-[28px] font-extrabold text-espresso">{decoded}</h1>
            <span className="font-data text-[10px] text-gold bg-gold-muted border border-gold-border px-2 py-0.5 rounded-md uppercase">{typeLabel}</span>
          </div>
        )}

        <hr className="border-border-base my-6" />

        {/* AI BRIEF SECTION */}
        <div className="mb-6">
          <p className="font-data text-[9px] uppercase tracking-widest text-gold font-semibold mb-3">
            AI Brief
          </p>
          {!loading && articles.length === 0 ? (
            <div className="bg-parchment-mid border border-border-base rounded-xl p-4">
              <p className="font-sans text-[13px] font-semibold text-text-primary mb-1">
                No recent coverage found for {decoded}.
              </p>
              <p className="font-sans text-[12px] text-text-secondary">
                Brief generation requires at least 1 article. Try searching{" "}
                <button onClick={() => router.push(`/live-feed`)} className="text-gold hover:underline cursor-pointer">Live Feed</button>
                {" "}for this company.
              </p>
            </div>
          ) : (
            <>
              {briefGeneratedAt === null && !loading && articles.length > 0 && (
                <div className="bg-parchment-mid border border-border-base rounded-xl p-4 mb-4">
                  <p className="font-data text-[9px] uppercase tracking-widest text-gold mb-1">What you'll get</p>
                  <p className="font-sans text-[12px] text-text-secondary leading-relaxed">
                    An AI-generated research brief grounded in {articles.length} recent articles — covering price action, company positioning, recent developments, upcoming catalysts, and key risks.
                  </p>
                </div>
              )}
              <button
                type="button"
                onClick={() => { setBriefGeneratedAt(new Date()); setMemoOpen(true); }}
                disabled={loading || articles.length === 0}
                className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gold text-cream font-sans text-[13px] font-semibold hover:bg-gold-dark transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Sparkles size={13} />
                {briefGeneratedAt !== null ? "Regenerate Brief" : "Generate Brief"}
              </button>
              {loading && (
                <p className="font-data text-[10px] text-text-faint mt-2">Loading articles...</p>
              )}
              {briefGeneratedAt !== null && (
                <p className="font-data text-[9px] text-text-faint mt-2">
                  Last generated {timeAgo(briefGeneratedAt.toISOString())}
                </p>
              )}
            </>
          )}
        </div>

        <hr className="border-border-base my-6" />

        {/* RECENT COVERAGE */}
        <div>
          {/* Section header with sort controls */}
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="font-data text-[9px] uppercase tracking-widest text-gold font-semibold">
                Recent Coverage ({articles.length})
              </p>
              {articles.length > 0 && (
                <p className="font-data text-[9px] text-text-faint mt-0.5">
                  Updated {timeAgo(articles[0].published_at || new Date().toISOString())}
                </p>
              )}
            </div>
            {articles.length > 0 && (
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
            )}
          </div>
          {/* Article list */}
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 rounded-xl" />
              ))}
            </div>
          ) : articles.length === 0 ? (
            <EmptyState
              icon={<ExternalLink size={24} />}
              title="No articles found"
              description="No recent coverage for this item"
              className="py-8"
            />
          ) : (
            <div className="space-y-2">
              {sortArticles(articles, sortMode).map((a) => (
                <div
                  key={a.id}
                  className="bg-white border border-border-base rounded-xl p-3"
                >
                  <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                    {(a.industry_verticals ?? []).map((v) => (
                      <span
                        key={v}
                        className="font-data text-[9px] px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200"
                      >
                        {v}
                      </span>
                    ))}
                    {(a.activity_types ?? []).map((t) => (
                      <span
                        key={t}
                        className="font-data text-[9px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200"
                      >
                        {t}
                      </span>
                    ))}
                    {a.source && (
                      <span className="font-data text-[9px] text-text-muted">
                        {a.source}
                      </span>
                    )}
                    {a.published_at && (
                      <span className="font-data text-[9px] text-text-faint ml-auto">
                        {timeAgo(a.published_at)}
                      </span>
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
                  <div className="flex items-start gap-2">
                    <h4 className="font-display text-[13px] font-bold text-espresso leading-snug flex-1">
                      {a.title}
                    </h4>
                    {a.url && (
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gold hover:text-gold-dark flex-shrink-0 mt-0.5"
                      >
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

      {/* Brief MemoModal */}
      {memoOpen && (
        <MemoModal
          isOpen={true}
          onClose={() => setMemoOpen(false)}
          title={decoded}
          content={briefContent}
          type="company"
          systemPrompt={systemPrompt}
        />
      )}

      {/* Article MemoModal */}
      {articleMemoEntry && (
        <MemoModal
          isOpen={true}
          onClose={() => setArticleMemoEntry(null)}
          title={articleMemoEntry.title}
          content={`${articleMemoEntry.title}\n${articleMemoEntry.source ?? ""}\n\n${articleMemoEntry.summary ?? ""}`}
          type="article"
        />
      )}
    </AppShell>
  );
}

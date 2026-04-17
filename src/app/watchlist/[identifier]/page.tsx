"use client";

import { use, useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { ArrowLeft, Sparkles, ExternalLink, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { createBrowserClient } from "@supabase/ssr";
import { MemoModal } from "@/components/memo/MemoModal";
import { buildArticleOrFilter } from "@/lib/watchlist-utils";
import { clusterArticles, type ArticleCluster } from "@/lib/clustering-utils";

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
  const [cachedBriefText, setCachedBriefText] = useState<string | null>(null);
  const [cachedBriefGeneratedAt, setCachedBriefGeneratedAt] = useState<Date | null>(null);
  const [quoteRefreshing, setQuoteRefreshing] = useState(false);
  const [storedDisplayName, setStoredDisplayName] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);
  const [noteLoading, setNoteLoading] = useState(true);
  const [notesOpen, setNotesOpen] = useState(false);
  const [noteUnauthenticated, setNoteUnauthenticated] = useState(false);
  const [selectedArticleIndex, setSelectedArticleIndex] = useState<number | null>(null);
  const notesFocusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [expandedClusters, setExpandedClusters] = useState<Map<string, boolean>>(new Map());

  const handleBriefGenerated = async (text: string) => {
    setBriefGeneratedAt(new Date());
    setCachedBriefText(text);
    setCachedBriefGeneratedAt(new Date());
    try {
      await getSupabase()
        .from("watchlist_briefs")
        .upsert(
          {
            identifier: decoded,
            brief_text: text,
            article_count: articles.length,
            generated_at: new Date().toISOString(),
            model: "gemini-2.5-flash",
          },
          { onConflict: "identifier" },
        );
    } catch (err) {
      console.warn("Brief cache write failed (non-critical):", err);
    }
  };

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
      // Load cached brief (if within 12-hour TTL)
      const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
      try {
        const { data: briefRow } = await getSupabase()
          .from("watchlist_briefs")
          .select("brief_text, generated_at")
          .eq("identifier", decoded)
          .maybeSingle();
        if (
          briefRow &&
          Date.now() - new Date(briefRow.generated_at).getTime() < TWELVE_HOURS_MS
        ) {
          if (!cancelled) {
            setCachedBriefText(briefRow.brief_text);
            setCachedBriefGeneratedAt(new Date(briefRow.generated_at));
          }
        }
      } catch {
        // Soft-fail — no cached brief available
      }

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
        // Cache-first: use pre-fetched watchlist_articles if available
        const [cacheRes, quoteResult] = await Promise.all([
          fetch(`/api/watchlist-articles?identifier=${encodeURIComponent(decoded)}`)
            .then((r) => (r.ok ? r.json() : { articles: [] }))
            .catch(() => ({ articles: [] })),
          quotePromise,
        ]);

        if (cancelled) return;
        setQuote(quoteResult);

        if (Array.isArray(cacheRes.articles) && cacheRes.articles.length > 0) {
          const cached = (cacheRes.articles as Record<string, unknown>[])
            .map((a) => ({
              id: a.article_id as string,
              title: a.title as string,
              source: a.source as string | undefined,
              url: a.url as string | undefined,
              industry_verticals: [] as string[],
              activity_types: [] as string[],
              published_at: a.published_at as string | undefined,
              summary: a.summary as string | undefined,
              relevance_score: (a.relevance_score as number | null) ?? 0,
            }))
            .filter((a) => isEnglishTitle(a.title));
          cached.sort((a, b) =>
            new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime(),
          );
          setArticles(cached.slice(0, 30));
          setLoading(false);
          return;
        }

        // Fallback: pipeline articles table
        // Fuzzy multi-term OR query — strips corporate suffixes from display_name
        // so "Goldman Sachs Group Inc" also finds articles about "Goldman Sachs".
        const displayNameForSearch: string | null =
          watchlistRow?.type === "company"
            ? null
            : (storedDN ?? LEGACY_TICKER_NAMES[decoded.toUpperCase()] ?? null);

        const orFilter = buildArticleOrFilter(decoded, displayNameForSearch, watchlistRow?.type ?? "ticker");

        const articleResult = await (async (): Promise<{ data: Record<string, unknown>[] | null }> => {
          if (!orFilter) return { data: [] };
          const result = await getSupabase()
            .from("articles")
            .select(articleSelect)
            .or(orFilter)
            .order("ingested_at", { ascending: false })
            .limit(30);
          return { data: (result.data ?? null) as Record<string, unknown>[] | null };
        })();

        if (cancelled) return;

        const merged = (articleResult.data || [])
          .map(mapRow)
          .filter((a) => isEnglishTitle(a.title));

        merged.sort((a, b) =>
          new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime(),
        );
        const finalArticles = merged.slice(0, 20);

        // Fallback: if still empty, fetch recent 50 globally and filter client-side
        if (finalArticles.length === 0) {
          const { data: fallback } = await getSupabase().from("articles")
            .select("id, title, source, url, industry_verticals, activity_types, published_at, ingested_at, summary, relevance_score")
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
              return t.includes(resolvedLC) || t.includes(decodedLC) ||
                     s.includes(resolvedLC) || s.includes(decodedLC);
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

  useEffect(() => {
    let cancelled = false;
    async function loadNote() {
      setNoteLoading(true);
      try {
        const res = await fetch(`/api/watchlist-notes?identifier=${encodeURIComponent(decoded)}`);
        if (res.status === 401) {
          if (!cancelled) setNoteUnauthenticated(true);
          return;
        }
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setNoteText(json.note?.note_text ?? "");
      } catch {
        // soft-fail: notes unavailable
      } finally {
        if (!cancelled) setNoteLoading(false);
      }
    }
    loadNote();
    return () => { cancelled = true; };
  }, [decoded]);

  const handleNoteSave = async (text: string) => {
    try {
      await fetch("/api/watchlist-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: decoded, note_text: text }),
      });
      setNoteSaved(true);
      setTimeout(() => setNoteSaved(false), 2000);
    } catch {
      // silent fail
    }
  };

  const companyName = storedDisplayName ?? LEGACY_TICKER_NAMES[decoded.toUpperCase()] ?? decoded;

  const systemPrompt = useMemo(
    () =>
      `You are a senior equity research analyst and investment professional with 15+ years of experience at a top-tier investment bank. You write concise, high-signal company intelligence briefs for institutional investors, portfolio managers, and finance professionals. Your writing is precise, jargon-fluent, and data-driven. You never pad with filler. You lead with the most investment-relevant insight. You write in the style of a Goldman Sachs or Morgan Stanley equity research note — factual, direct, structured.`,
    [],
  );

  const typeLabel = isSector
    ? "sector"
    : decoded === decoded.toUpperCase() && decoded.length <= 5
      ? "ticker"
      : "company";

  const briefContent = useMemo(() => {
    const articleContext = sortArticles(articles, "newest")
      .slice(0, 8)
      .map((a) => {
        const date = a.published_at ? timeAgo(a.published_at) : "unknown date";
        const summaryLine = a.summary && a.summary.trim().length > 20
          ? ` ${a.summary.trim().slice(0, 300)}`
          : "";
        return `[${a.source ?? "Unknown"}] ${date}: ${a.title}.${summaryLine}`;
      })
      .join("\n");

    const contextBlock = articleContext.trim()
      ? articleContext
      : "No recent coverage available — use background knowledge and flag all claims with [Background knowledge].";

    if (isSector) {
      return `Write a sector intelligence brief for the ${companyName} sector based on the following recent news and coverage.

Recent coverage:
${contextBlock}

Your brief must follow this exact structure:

**SECTOR PULSE**
One sentence: the defining theme or dynamic in this sector right now and why it matters to investors.

**KEY MOVES**
2-3 bullet points covering the most significant recent deals, fundraises, earnings surprises, leadership changes, or competitive shifts. Each bullet must be specific — name companies, amounts, and dates where available.

**MACRO CONTEXT**
2-3 bullet points on macro tailwinds or headwinds affecting this sector: interest rate sensitivity, regulatory pressures, commodity exposure, geopolitical factors, or structural trends.

**SIGNAL**
One sentence: the single most important thing to watch in this sector right now from an investment perspective.

Constraints:
- Total length: 150-250 words
- No preamble, no "Here is your brief", start directly with SECTOR PULSE
- If recent coverage is sparse, draw on your knowledge but flag it: prefix any non-news-sourced claim with [Background knowledge]
- Never fabricate specific numbers, deals, or dates not present in the provided articles
- Write for a reader who already knows what a P/E ratio is`;
    }

    return `Write a company intelligence brief for ${companyName}${companyName !== decoded ? ` (${decoded})` : ""} based on the following recent news and context.
${quote ? `\nCurrent market data: ${decoded} trading at $${quote.price} (${quote.pct >= 0 ? "+" : ""}${quote.pct}% today).` : ""}

Recent coverage:
${contextBlock}

Your brief must follow this exact structure:

**COMPANY SNAPSHOT**
One sentence: what this company does, its market position, and why it matters to investors right now.

**KEY DEVELOPMENTS**
2-3 bullet points covering the most investment-relevant recent events. Each bullet must be specific — name deals, amounts, counterparties, dates where available. No vague statements.

**INVESTMENT CONSIDERATIONS**
2-3 bullet points on what a sophisticated investor should be watching: catalysts, risks, competitive dynamics, valuation considerations, or macro tailwinds/headwinds relevant to this company.

**SIGNAL**
One sentence: the single most important thing to know about this company right now from an investment perspective.

Constraints:
- Total length: 150-250 words
- No preamble, no "Here is your brief", start directly with COMPANY SNAPSHOT
- If recent coverage is sparse, draw on your knowledge of the company but flag it: prefix any non-news-sourced claim with [Background knowledge]
- Never fabricate specific numbers, deals, or dates not present in the provided articles
- Write for a reader who already knows what a P/E ratio is`;
  }, [decoded, companyName, isSector, quote, articles]);

  function isTyping(): boolean {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName.toUpperCase();
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
      (el as HTMLElement).contentEditable === "true";
  }

  const sortedArticles = useMemo(() => sortArticles(articles, sortMode), [articles, sortMode]);
  const clusters = useMemo(() => clusterArticles(sortedArticles), [sortedArticles]);

  useEffect(() => {
    const isAnyModalOpen = memoOpen || articleMemoEntry !== null;

    function handleKeyDown(e: KeyboardEvent) {
      if (isTyping()) return;
      // Also skip if notes textarea is focused
      const notesEl = document.getElementById("notes-textarea");
      if (notesEl && document.activeElement === notesEl) return;

      switch (e.key) {
        case "j":
        case "J":
          e.preventDefault();
          if (!isAnyModalOpen && clusters.length > 0) {
            setSelectedArticleIndex(prev =>
              Math.max(0, Math.min(clusters.length - 1, prev === null ? 0 : prev + 1))
            );
          }
          break;
        case "k":
        case "K":
          e.preventDefault();
          if (!isAnyModalOpen && clusters.length > 0) {
            setSelectedArticleIndex(prev =>
              Math.max(0, Math.min(clusters.length - 1, prev === null ? 0 : prev - 1))
            );
          }
          break;
        case "o":
        case "O":
          if (!isAnyModalOpen && selectedArticleIndex !== null && clusters[selectedArticleIndex]?.leadArticle?.url) {
            e.preventDefault();
            window.open(clusters[selectedArticleIndex].leadArticle.url, "_blank", "noopener,noreferrer");
          }
          break;
        case "b":
        case "B":
          if (!isAnyModalOpen && !loading) {
            e.preventDefault();
            setBriefGeneratedAt(new Date());
            setMemoOpen(true);
          }
          break;
        case "n":
        case "N":
          if (!isAnyModalOpen) {
            e.preventDefault();
            const textarea = document.getElementById("notes-textarea") as HTMLTextAreaElement | null;
            if (textarea) {
              setNotesOpen(true);
              if (notesFocusTimeoutRef.current) clearTimeout(notesFocusTimeoutRef.current);
              notesFocusTimeoutRef.current = setTimeout(() => {
                textarea.scrollIntoView({ behavior: "smooth", block: "nearest" });
                textarea.focus();
              }, 50);
            }
          }
          break;
        case "Escape":
          e.preventDefault();
          if (memoOpen) {
            setMemoOpen(false);
          } else if (articleMemoEntry !== null) {
            setArticleMemoEntry(null);
          } else {
            router.back();
          }
          break;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [memoOpen, articleMemoEntry, selectedArticleIndex, clusters, sortedArticles, loading, router]);

  useEffect(() => {
    if (selectedArticleIndex === null) return;
    const el = document.querySelector(`[data-cluster-idx="${selectedArticleIndex}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedArticleIndex]);

  useEffect(() => {
    return () => {
      if (notesFocusTimeoutRef.current) clearTimeout(notesFocusTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    setSelectedArticleIndex(null);
  }, [sortMode]);

  return (
    <AppShell
      pageTitle={decoded}
      mood="neutral"
      moodHeadline="Markets steady"
      moodDetails={["VIX 14.2", "S&P +0.38%"]}
    >
      <style>{`
  @media print {
    [data-sidebar], nav, .topbar, header { display: none !important; }
    body { background: white !important; }
    #company-print-content { display: block !important; }
    .p-6.max-w-\\[1100px\\] { display: none !important; }
  }
`}</style>
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
                No recent Supabase coverage for {decoded}.
              </p>
              <p className="font-sans text-[12px] text-text-secondary">
                The brief generator needs at least 1 article from our pipeline. Try the{" "}
                <button onClick={() => router.push(`/live-feed`)} className="text-gold hover:underline cursor-pointer">Live Feed</button>
                {" "}or check back after the next pipeline run (6am / 8pm ET weekdays).
              </p>
            </div>
          ) : (
            <>
              {/* Cached brief available */}
              {cachedBriefText && !memoOpen && (
                <div className="mb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-data text-[9px] text-text-faint">
                      Generated {cachedBriefGeneratedAt ? timeAgo(cachedBriefGeneratedAt.toISOString()) : "recently"}
                    </span>
                    <span className="font-data text-[8px] text-text-faint bg-parchment-mid border border-border-base px-1.5 py-0.5 rounded">
                      Cached
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setMemoOpen(true)}
                      disabled={loading}
                      className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gold text-cream font-sans text-[13px] font-semibold hover:bg-gold-dark transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <Sparkles size={13} />
                      View Brief
                    </button>
                    <button
                      type="button"
                      onClick={() => { setCachedBriefText(null); setCachedBriefGeneratedAt(null); setMemoOpen(true); }}
                      disabled={loading || articles.length === 0}
                      className="px-4 py-3 rounded-xl border border-border-base bg-white text-text-muted font-sans text-[13px] hover:text-text-primary transition-colors cursor-pointer disabled:opacity-50"
                    >
                      Regenerate
                    </button>
                  </div>
                </div>
              )}

              {/* No cached brief */}
              {!cachedBriefText && (
                <>
                  {briefGeneratedAt === null && !loading && articles.length > 0 && (
                    <div className="bg-parchment-mid border border-border-base rounded-xl p-4 mb-4">
                      <p className="font-data text-[9px] uppercase tracking-widest text-gold mb-1">What you'll get</p>
                      <p className="font-sans text-[12px] text-text-secondary leading-relaxed">
                        An AI-generated research brief grounded in {articles.length} recent {articles.length === 1 ? "article" : "articles"} — structured like a bulge bracket equity research note with company snapshot, key developments, investment considerations, and a signal.
                      </p>
                      <p className="font-data text-[10px] text-text-faint italic mt-1.5">
                        AI-generated · Based on recent coverage · Not financial advice
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

              {/* Export PDF button */}
              {!isSector && (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-border-base bg-white text-text-muted font-sans text-[12px] hover:text-text-primary transition-colors cursor-pointer w-full"
                  >
                    Export PDF
                  </button>
                  <p className="font-data text-[9px] text-text-faint mt-1 text-center">Opens print dialog — select &ldquo;Save as PDF&rdquo;</p>
                </div>
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
              {articles.length > 0 && timeAgo(articles[0].published_at) && (
                <p className="font-data text-[9px] text-text-faint mt-0.5">
                  Updated {timeAgo(articles[0].published_at)}
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
          {/* Article list with clustering */}
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
              {clusters.map((cluster, idx) => {
                const a = cluster.leadArticle;
                const isSelected = selectedArticleIndex === idx;
                const isExpanded = expandedClusters.get(cluster.id) ?? false;
                return (
                  <div key={cluster.id} data-cluster-idx={idx}>
                    {/* Lead article card */}
                    <div
                      className="bg-white border border-border-base rounded-xl p-3"
                      style={{ borderLeft: isSelected ? '2px solid #d97706' : undefined }}
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
                        {a.published_at && timeAgo(a.published_at) && (
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

                    {/* Cluster expand row */}
                    {cluster.isCluster && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedClusters((prev) => {
                              const next = new Map(prev);
                              next.set(cluster.id, !isExpanded);
                              return next;
                            })
                          }
                          className="flex items-center gap-1.5 mt-1 ml-2 font-data text-[10px] cursor-pointer transition-colors"
                          style={{ color: '#d97706', background: 'none', border: 'none', padding: '2px 4px' }}
                        >
                          <ChevronDown
                            size={12}
                            style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.18s ease' }}
                          />
                          {isExpanded ? 'Collapse' : `${cluster.relatedArticles.length} more source${cluster.relatedArticles.length === 1 ? '' : 's'}`}
                        </button>

                        {isExpanded && (
                          <div className="space-y-1 mt-1 ml-3">
                            {cluster.relatedArticles.map((ra) => (
                              <div
                                key={ra.id}
                                className="bg-white border border-border-base rounded-xl p-2.5"
                                style={{ borderLeft: '2px solid #d97706' }}
                              >
                                <div className="flex flex-wrap items-center gap-1.5 mb-1">
                                  {ra.source && (
                                    <span className="font-data text-[9px] text-text-muted">{ra.source}</span>
                                  )}
                                  {ra.published_at && timeAgo(ra.published_at) && (
                                    <span className="font-data text-[9px] text-text-faint ml-auto">
                                      {timeAgo(ra.published_at)}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-start gap-2">
                                  <h4 className="font-display text-[12px] font-bold text-espresso leading-snug flex-1">
                                    {ra.title}
                                  </h4>
                                  {ra.url && (
                                    <a
                                      href={ra.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-gold hover:text-gold-dark flex-shrink-0 mt-0.5"
                                    >
                                      <ExternalLink size={10} />
                                    </a>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <hr className="border-border-base my-6" />

        {/* NOTES SECTION */}
        <div className="mb-6">
          <button
            type="button"
            onClick={() => setNotesOpen(o => !o)}
            className="flex items-center gap-2 group w-full text-left"
          >
            <p className="font-data text-[9px] uppercase tracking-widest text-gold font-semibold">
              Notes
            </p>
            {notesOpen ? (
              <ChevronUp size={11} className="text-text-faint group-hover:text-gold transition-colors" />
            ) : (
              <ChevronDown size={11} className="text-text-faint group-hover:text-gold transition-colors" />
            )}
          </button>

          {notesOpen && (
            <div className="mt-3">
              {noteUnauthenticated ? (
                <p className="font-sans text-[12px] text-text-muted">Sign in to save notes.</p>
              ) : noteLoading ? (
                <div className="h-[80px] bg-parchment-mid border border-border-base rounded-xl animate-pulse" />
              ) : (
                <div>
                  <textarea
                    id="notes-textarea"
                    className="w-full min-h-[80px] bg-parchment-mid border border-border-base rounded-xl px-4 py-3 font-sans text-[12px] text-text-primary placeholder:text-text-faint resize-y focus:outline-none focus:border-gold transition-colors"
                    placeholder="Add a note..."
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    onBlur={(e) => handleNoteSave(e.target.value)}
                  />
                  <div className="flex justify-end items-center gap-2 mt-1.5">
                    {noteSaved && (
                      <span className="font-data text-[9px] text-signal-up">Saved ✓</span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleNoteSave(noteText)}
                      className="px-3 py-1 rounded-md bg-gold text-cream font-data text-[10px] font-semibold hover:bg-gold-dark transition-colors cursor-pointer"
                    >
                      Save note
                    </button>
                  </div>
                </div>
              )}
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
          preloadedMemo={cachedBriefText ?? undefined}
          onGenerated={handleBriefGenerated}
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

      {/* Print-only layout — hidden on screen, visible when printing */}
      <div id="company-print-content" className="hidden print:block p-8 font-sans">
        <div className="flex justify-between items-start mb-6">
          <div>
            <p className="text-[10px] uppercase tracking-[3px] text-gray-500 mb-1">Signalera Research Note</p>
            <h1 className="text-[28px] font-bold text-gray-900">{decoded}</h1>
            {(storedDisplayName ?? LEGACY_TICKER_NAMES[decoded.toUpperCase()]) && (
              <p className="text-[14px] text-gray-500 mt-0.5">{storedDisplayName ?? LEGACY_TICKER_NAMES[decoded.toUpperCase()]}</p>
            )}
          </div>
          <p className="text-[11px] text-gray-400">{new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
        </div>
        <hr className="border-gray-300 mb-6" />

        {cachedBriefText && (
          <div className="mb-6">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">AI Brief</p>
            <div className="text-[12px] text-gray-700 leading-relaxed whitespace-pre-wrap">{cachedBriefText}</div>
          </div>
        )}

        {noteText && (
          <div className="mb-6">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Analyst Note</p>
            <p className="text-[12px] italic text-gray-600">{noteText}</p>
          </div>
        )}

        {articles.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-3">Recent Coverage</p>
            <div className="space-y-3">
              {articles.slice(0, 15).map((a, i) => (
                <div key={a.id ?? i} className="border-b border-gray-100 pb-3">
                  <p className="text-[12px] font-bold text-gray-900">{a.title}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {[a.source, a.published_at ? new Date(a.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null].filter(Boolean).join(" · ")}
                  </p>
                  {a.summary && <p className="text-[11px] text-gray-600 mt-0.5">{a.summary}</p>}
                  {a.url && <p className="text-[9px] text-gray-400 mt-0.5">{a.url}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-12 pt-4 border-t border-gray-200">
          <p className="text-[9px] text-gray-400 text-center">
            Generated by Signalera · {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} · AI-generated content · Not financial advice
          </p>
        </div>
      </div>
    </AppShell>
  );
}

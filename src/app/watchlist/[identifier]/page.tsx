"use client";

import { use, useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { ArrowLeft, Sparkles, ExternalLink } from "lucide-react";
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

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
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
  const [briefGenerated, setBriefGenerated] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const quotePromise = !isSector
        ? fetch(`/api/watchlist-quotes?symbols=${decoded}`)
            .then((r) => r.json())
            .then((d) => d.quotes?.[decoded] ?? null)
            .catch(() => null)
        : Promise.resolve(null);

      let query;
      if (isSector) {
        query = getSupabase()
          .from("articles")
          .select(
            "id, title, source, url, sector, industry_verticals, activity_types, published_at, ingested_at, summary, relevance_score",
          )
          .contains("industry_verticals", [decoded])
          .order("ingested_at", { ascending: false })
          .limit(20);
      } else {
        query = getSupabase()
          .from("articles")
          .select(
            "id, title, source, url, sector, industry_verticals, activity_types, published_at, ingested_at, summary, companies, relevance_score",
          )
          .or(`title.ilike.%${ident}%,companies.cs.["${decoded}"]`)
          .order("ingested_at", { ascending: false })
          .limit(20);
      }

      const [quoteResult, articlesResult] = await Promise.all([
        quotePromise,
        query,
      ]);

      if (cancelled) return;

      setQuote(quoteResult);
      setArticles(
        (articlesResult.data || []).map(
          (a: Record<string, unknown>) => ({
            id: a.id as string,
            title: a.title as string,
            source: a.source as string | undefined,
            url: a.url as string | undefined,
            industry_verticals:
              (a.industry_verticals as string[] | null) ?? [],
            activity_types: (a.activity_types as string[] | null) ?? [],
            published_at:
              (a.published_at as string | null) ||
              (a.ingested_at as string | null) ||
              undefined,
            summary: a.summary as string | undefined,
            relevance_score: (a.relevance_score as number | null) ?? 0,
          }),
        ),
      );
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [decoded]);

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
    return `Ticker/Company: ${decoded}
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
  }, [decoded, typeLabel, quote, articles]);

  return (
    <AppShell
      pageTitle={decoded}
      mood="neutral"
      moodHeadline="Markets steady"
      moodDetails={["VIX 14.2", "S&P +0.38%"]}
    >
      <div className="p-6 max-w-[900px]">
        {/* Back button */}
        <button
          type="button"
          onClick={() => router.push("/watchlist")}
          className="inline-flex items-center gap-1.5 font-data text-[11px] text-text-muted hover:text-text-primary cursor-pointer transition-colors"
        >
          <ArrowLeft size={14} /> Watchlist
        </button>

        {/* Header */}
        <div className="mt-4 mb-6">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="font-display text-[28px] font-extrabold text-espresso">
              {decoded}
            </h1>
            <span className="font-data text-[10px] text-gold bg-gold-muted border border-gold-border px-2 py-0.5 rounded-md uppercase">
              {typeLabel}
            </span>
          </div>
          {/* Price (non-sector only) */}
          {!isSector && (
            <div className="flex items-center gap-3">
              {quote ? (
                <>
                  <span className="font-data text-[24px] font-bold text-espresso">
                    ${quote.price}
                  </span>
                  <span
                    className={cn(
                      "font-data text-[16px] font-semibold",
                      quote.pct >= 0 ? "text-signal-up" : "text-signal-dn",
                    )}
                  >
                    {quote.pct >= 0 ? "+" : ""}
                    {quote.pct}%
                  </span>
                  <span className="font-data text-[10px] text-text-faint">
                    as of market close
                  </span>
                </>
              ) : (
                !loading && (
                  <span className="font-data text-[13px] text-text-faint">
                    Price unavailable
                  </span>
                )
              )}
            </div>
          )}
        </div>

        {/* AI BRIEF SECTION */}
        <div className="mb-8">
          <p className="font-data text-[9px] uppercase tracking-widest text-gold font-semibold mb-3">
            AI Brief
          </p>
          <button
            type="button"
            onClick={() => {
              setBriefGenerated(true);
              setMemoOpen(true);
            }}
            disabled={loading || articles.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gold text-cream font-sans text-[12px] font-semibold hover:bg-gold-dark transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Sparkles size={13} />
            {briefGenerated ? "Regenerate Brief" : "Generate Brief"}
          </button>
          {loading && (
            <p className="font-data text-[10px] text-text-faint mt-2">
              Loading articles...
            </p>
          )}
          {!loading && articles.length === 0 && (
            <p className="font-data text-[10px] text-text-faint mt-2">
              No articles found — brief generation unavailable
            </p>
          )}
        </div>

        {/* RECENT COVERAGE */}
        <div>
          <p className="font-data text-[9px] uppercase tracking-widest text-gold font-semibold mb-3">
            Recent Coverage ({articles.length})
          </p>
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
              {articles.map((a) => (
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
                  <div className="flex justify-end mt-2">
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

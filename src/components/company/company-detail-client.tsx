"use client";

import { useState, useEffect, useCallback } from "react";
import { Bookmark, BookmarkCheck, Sparkles, ExternalLink } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Building2 } from "lucide-react";
import { MemoModal } from "@/components/memo/MemoModal";
import { CompanyStockChart } from "@/components/company/CompanyStockChart";
import { getSectorStyle } from "@/lib/sector-colors";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/company-intel";
import { CompletenessBadge, SignalScore, SourceCredibilityBadge, getCompleteness, getAdjustedScore } from "@/lib/article-signal";
import type { CompanyArticle } from "@/lib/company-intel";

export type CredibilityMap = Record<string, number>;

interface CompanyDetailClientProps {
  companyName: string;
  industry: string | null;
  ticker?: string | null;
  developmentArticles: CompanyArticle[];
  contextArticles: CompanyArticle[];
  memoContent: string;
  systemPrompt: string;
  totalArticles: number;
  credibilityMap?: CredibilityMap;
}

// Sentinel for the in-flight POST window. Mirrors the directory page's race
// guard so a rapid double-click does not produce two POSTs (the second would
// 400 on the server-side ilike duplicate check, but the rollback would then
// flip the local state back to "not watched" while the row is actually
// present -- the visible bug we are fixing).
const PENDING_ID = "__pending__";

export function CompanyDetailClient({
  companyName,
  industry,
  ticker = null,
  developmentArticles,
  contextArticles,
  memoContent,
  systemPrompt,
  totalArticles,
  credibilityMap = {},
}: CompanyDetailClientProps) {
  const [memoOpen, setMemoOpen] = useState(false);
  const [memoToast, setMemoToast] = useState("");

  // Watchlist row id when this company is in the user's list, null otherwise.
  // PENDING_ID while a POST is in-flight (used as the optimistic placeholder
  // before the server returns the real row id).
  const [watchlistEntryId, setWatchlistEntryId] = useState<string | null>(null);
  const isInWatchlist = watchlistEntryId !== null;

  // Hydrate watchlist state on mount. Sidebar already revalidates its count
  // via a Supabase postgres_changes subscription on the watchlist table
  // (see src/components/shell/sidebar.tsx ~L197), so the detail page only
  // needs to manage local button state -- no manual sidebar broadcast.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/watchlist");
        if (!res.ok) return; // 401 signed out, soft-fail
        const json = (await res.json()) as {
          entries?: Array<{ id: string; identifier: string; type: string }>;
        };
        if (cancelled) return;
        const target = companyName.toLowerCase();
        const match = (json.entries ?? []).find(
          (e) => e.type === "company" && e.identifier.toLowerCase() === target,
        );
        setWatchlistEntryId(match?.id ?? null);
      } catch {
        // soft-fail: button still functional, just defaults to "Add"
      }
    })();
    return () => { cancelled = true; };
  }, [companyName]);

  const handleToggleWatchlist = useCallback(async () => {
    // Race guard: ignore re-clicks while a previous toggle is still in flight.
    if (watchlistEntryId === PENDING_ID) return;
    const prev = watchlistEntryId;
    // Optimistic update
    setWatchlistEntryId(prev ? null : PENDING_ID);
    try {
      if (prev && prev !== PENDING_ID) {
        const res = await fetch("/api/watchlist", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: prev }),
        });
        if (!res.ok) throw new Error(`DELETE failed: ${res.status}`);
      } else {
        const res = await fetch("/api/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            identifier: companyName,
            type: "company",
            display_name: companyName,
          }),
        });
        if (!res.ok) throw new Error(`POST failed: ${res.status}`);
        const json = (await res.json()) as { entry?: { id: string } };
        if (json.entry?.id) setWatchlistEntryId(json.entry.id);
      }
    } catch (e) {
      console.error("Watchlist toggle failed:", e);
      // Rollback to whatever it was before the click.
      setWatchlistEntryId(prev);
    }
  }, [companyName, watchlistEntryId]);

  return (
    <div className="flex flex-col min-h-screen bg-cream">
      {/* Header */}
      <div className="border-b border-border-base bg-white px-6 py-5">
        <div className="max-w-[960px] mx-auto">
          <h1 className="font-display text-[24px] font-extrabold text-espresso leading-tight">
            {companyName}
          </h1>
          {industry && (
            <p className="font-sans text-[12px] text-text-secondary mt-0.5">{industry}</p>
          )}
          <p className="font-sans text-[12px] text-text-muted mt-1">
            {totalArticles} article{totalArticles !== 1 ? "s" : ""} in current feed window
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="px-6 py-4 border-b border-border-base bg-white">
        <div className="max-w-[960px] mx-auto flex items-center gap-2">
          <button
            type="button"
            onClick={handleToggleWatchlist}
            disabled={watchlistEntryId === PENDING_ID}
            aria-pressed={isInWatchlist}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-sans text-[11px] font-medium transition-colors cursor-pointer",
              isInWatchlist
                ? "bg-gold-muted border-gold-border text-gold hover:bg-gold/10"
                : "bg-parchment-mid border-border-base text-text-secondary hover:border-border-hover",
              watchlistEntryId === PENDING_ID && "opacity-60 cursor-wait",
            )}
          >
            {isInWatchlist ? <BookmarkCheck size={11} /> : <Bookmark size={11} />}
            {isInWatchlist ? "Remove from Watchlist" : "Add to Watchlist"}
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                if (totalArticles === 0) {
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
      </div>

      {/* Articles */}
      <div className="flex-1 px-6 py-5">
        <div className="max-w-[960px] mx-auto">

          {/* Stock chart, public equities only */}
          {ticker && (
            <div className="mb-4">
              <CompanyStockChart ticker={ticker} companyName={companyName} />
            </div>
          )}

          {/* Articles header */}
          <p className="font-data text-[9px] uppercase tracking-widest text-gold font-semibold mb-3">
            Articles Mentioning {companyName.toUpperCase()} ({totalArticles})
            {developmentArticles.length > 0 && (
              <span className="ml-2 text-gold normal-case">
                · {developmentArticles.length} development{developmentArticles.length !== 1 ? "s" : ""}
              </span>
            )}
          </p>

          {/* Sparse-evidence notice */}
          {totalArticles > 0 && developmentArticles.length === 0 && (
            <div className="mb-4 px-3 py-2.5 rounded-xl border border-border-base bg-parchment-mid">
              <p className="font-sans text-[11px] font-semibold text-text-primary leading-snug">
                No company events in this feed window.
              </p>
              <p className="font-sans text-[11px] text-text-secondary leading-snug mt-0.5">
                {companyName} appears in {contextArticles.length} sector context article{contextArticles.length !== 1 ? "s" : ""} — no earnings, funding, M&A, or IPO found. A context-led brief is available.
              </p>
            </div>
          )}

          {totalArticles === 0 ? (
            <EmptyState
              icon={<Building2 size={24} />}
              title="No articles found"
              description="No recent articles mention this company"
              className="py-8"
            />
          ) : (
            <div className="space-y-2">
              {/* Company Events group */}
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
                        <SourceCredibilityBadge winRate={a.source ? credibilityMap[a.source] ?? null : null} />
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

              {/* Sector Context group */}
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
                        <SourceCredibilityBadge winRate={a.source ? credibilityMap[a.source] ?? null : null} />
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

      <MemoModal
        isOpen={memoOpen}
        onClose={() => setMemoOpen(false)}
        title={companyName}
        content={memoContent}
        type="company"
        systemPrompt={systemPrompt}
      />
    </div>
  );
}

"use client";

import { useState } from "react";
import { Bookmark, Sparkles, ExternalLink } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Building2 } from "lucide-react";
import { MemoModal } from "@/components/memo/MemoModal";
import { getSectorStyle } from "@/lib/sector-colors";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/company-intel";
import { CompletenessBadge, SignalScore, SourceCredibilityBadge, getCompleteness, getAdjustedScore } from "@/lib/article-signal";
import type { CompanyArticle } from "@/lib/company-intel";

export type CredibilityMap = Record<string, number>;

interface CompanyDetailClientProps {
  companyName: string;
  industry: string | null;
  developmentArticles: CompanyArticle[];
  contextArticles: CompanyArticle[];
  memoContent: string;
  systemPrompt: string;
  totalArticles: number;
  credibilityMap?: CredibilityMap;
}

export function CompanyDetailClient({
  companyName,
  industry,
  developmentArticles,
  contextArticles,
  memoContent,
  systemPrompt,
  totalArticles,
  credibilityMap = {},
}: CompanyDetailClientProps) {
  const [memoOpen, setMemoOpen] = useState(false);
  const [memoToast, setMemoToast] = useState("");

  const handleAddToWatchlist = async () => {
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
    <div className="flex flex-col min-h-screen bg-cream">
      {/* Header */}
      <div className="border-b border-border-base bg-white px-6 py-5">
        <div className="max-w-[720px]">
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
        <div className="max-w-[720px] flex items-center gap-2">
          <button
            type="button"
            onClick={handleAddToWatchlist}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-parchment-mid border border-border-base font-sans text-[11px] font-medium text-text-secondary hover:border-border-hover transition-colors cursor-pointer"
          >
            <Bookmark size={11} />
            Add to Watchlist
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
        <div className="max-w-[720px]">

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
                    const cmplt = getCompleteness(a.summary);
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
                    const cmplt = getCompleteness(a.summary);
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

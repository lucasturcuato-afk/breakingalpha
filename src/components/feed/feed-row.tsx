"use client";

import { cn } from "@/lib/utils";
import { stripHtml } from "@/lib/strip-html";
import { withCompanyLine } from "@/lib/memo-company-line";
import { makeCallLink } from "@/lib/make-call-link";
import { getSectorStyle, getTagPillStyle } from "@/lib/sector-colors";
import { memo, useMemo, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { SentimentPill, sentimentToTone } from "@/components/ui/sentiment-pill";
import { Sparkles, Plus, MessageSquare, ExternalLink, Bookmark, BookmarkCheck } from "lucide-react";
import { MemoModal } from "@/components/memo/MemoModalLazy";
import { CompletenessBadge, SignalScore, SourceCredibilityBadge } from "@/lib/article-signal";
import type { StoryData } from "@/components/dashboard";

interface FeedRowProps {
  story: StoryData;
  saved?: boolean;
  onBookmark?: (id: string) => void;
}

function FeedRowInner({ story, saved: savedProp, onBookmark }: FeedRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [memoOpen, setMemoOpen] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  // Prefer explicit `saved` prop; fall back to legacy `story.saved` for unmigrated callers
  const saved = savedProp ?? story.saved ?? false;
  const cleanSummary = useMemo(() => stripHtml(story.summary ?? ""), [story.summary]);
  const router = useRouter();

  useEffect(() => {
    if (!justSaved) return;
    const timer = setTimeout(() => setJustSaved(false), 1500);
    return () => clearTimeout(timer);
  }, [justSaved]);

  return (
    <div
      className={cn(
        "border-b border-border-subtle",
        "transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
        "hover:bg-parchment-mid dark:bg-[#161616] dark:hover:bg-[#1e1e1e]",
        story.read && "opacity-72",
      )}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      <div className="flex items-start gap-3 px-6 py-3">
        {/* Unread dot */}
        <div className="w-2 flex-shrink-0 pt-2">
          {!story.read && (
            <span className="block w-2 h-2 rounded-full bg-gold" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Meta row */}
          <div className="flex items-center gap-2 mb-1">
            <SentimentPill tone={sentimentToTone(story.sentiment)} size="xs" />
            <div className="flex flex-wrap gap-1.5">
              {/* Industry Vertical Pills */}
              {(story.industry_verticals ?? []).length > 0
                ? (story.industry_verticals ?? []).map((v) => (
                    <span
                      key={v}
                      style={{ ...getTagPillStyle(v), borderRadius: "3px" }}
                      className="inline-flex items-center px-2 py-0.5 text-xs font-medium"
                    >
                      {v}
                    </span>
                  ))
                : story.sector
                ? (
                    <span
                      style={getSectorStyle(story.sector)}
                      className="font-sans text-[9px] font-semibold px-2 py-0.5 rounded"
                    >
                      {story.sector}
                    </span>
                  )
                : null
              }
              {/* Activity Type Pills */}
              {(story.activity_types ?? []).map((a) => (
                <span
                  key={a}
                  style={{ ...getTagPillStyle(a), borderRadius: "3px" }}
                  className="inline-flex items-center px-2 py-0.5 text-xs font-medium"
                >
                  {a}
                </span>
              ))}
            </div>
            <span className="font-sans text-[11px] text-text-muted font-medium">
              {story.source}
            </span>
            <span className="font-sans text-[10px] text-text-faint ml-auto flex-shrink-0">
              {story.timestamp}
            </span>
            <CompletenessBadge completeness={story.completeness} />
            <SignalScore score={story.adjustedScore} />
            <SourceCredibilityBadge winRate={story.sourceWinRate} />
          </div>

          {/* Headline */}
          <h3 className="font-display text-[14px] font-bold text-espresso leading-snug hover:text-gold-dark transition-colors">
            {story.title}
          </h3>

          {/* Expanded content */}
          <div
            className={cn(
              "overflow-hidden transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
              expanded ? "max-h-48 opacity-100 mt-2" : "max-h-0 opacity-0 mt-0",
            )}
          >
            {story.summary && (
              <p className="font-sans text-[12px] text-text-secondary leading-[1.55] mb-2">
                {cleanSummary}
              </p>
            )}

            {/* Tags */}
            {story.tags && story.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2.5">
                {story.tags.map((tag) => (
                  <span
                    key={tag}
                    className="font-sans text-[10px] px-2 py-0.5 bg-parchment border border-border-base rounded-md text-text-muted"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMemoOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gold text-cream font-sans text-[11px] font-semibold hover:bg-gold-dark transition-colors cursor-pointer"
              >
                <Sparkles size={11} />
                Generate Memo
              </button>
              <button
                  type="button"
                  onClick={() => router.push(makeCallLink(story.title))}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-parchment border border-border-base font-sans text-[11px] font-medium text-text-secondary hover:border-border-hover transition-colors cursor-pointer"
                >
                  <Plus size={11} />
                  Make a call
                </button>
              <button
                type="button"
                disabled
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-parchment border border-border-base font-sans text-[11px] font-medium text-text-faint opacity-60 cursor-not-allowed"
                title="Ask AI is coming soon"
              >
                <MessageSquare size={11} />
                Ask AI
                <span className="ml-1 px-1 py-0.5 rounded bg-parchment-mid text-[8px] font-semibold text-text-muted">
                  Soon
                </span>
              </button>
              {story.url && (
                <a
                  href={story.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg font-sans text-[11px] font-medium text-text-muted hover:text-text-primary transition-colors"
                >
                  <ExternalLink size={10} />
                  Source
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Bookmark + saved actions */}
        <div className="flex items-center gap-1 flex-shrink-0 relative">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (!saved) setJustSaved(true);
              onBookmark?.(story.id);
            }}
            className={cn(
              "p-1 rounded transition-all cursor-pointer",
              expanded || saved ? "opacity-100" : "opacity-0",
            )}
          >
            {saved
              ? <BookmarkCheck size={13} className="text-gold" />
              : <Bookmark size={13} className="text-text-muted hover:text-gold transition-colors" />
            }
          </button>
          {saved && story.url && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                window.open(story.url, "_blank");
              }}
              className="font-sans text-[9px] text-gold hover:underline cursor-pointer"
            >
              Open &rarr;
            </button>
          )}
          {/* Save toast */}
          {justSaved && (
            <div className="absolute -top-7 right-0 whitespace-nowrap bg-espresso text-cream font-sans text-[10px] px-2 py-1 rounded-md z-10">
              Saved to reading list
            </div>
          )}
        </div>
      </div>
      {memoOpen && (
        <MemoModal
          isOpen={memoOpen}
          onClose={() => setMemoOpen(false)}
          title={story.title}
          content={withCompanyLine([story.title, cleanSummary].join("\n\n"), story.companies?.[0])}
          type="article"
        />
      )}
    </div>
  );
}

/**
 * Memoized so that chip filter clicks don't re-render every row in the list.
 * Shallow compare on props works because `story` refs from the parent's
 * `stories[]` array are stable across filter changes, `saved` is a boolean,
 * and `onBookmark` is useCallback'd in the caller.
 */
export const FeedRow = memo(FeedRowInner);

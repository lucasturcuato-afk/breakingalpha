"use client";

import { cn } from "@/lib/utils";
import { stripHtml } from "@/lib/strip-html";
import { getSectorStyle, getVerticalStyle, getActivityTypeStyle } from "@/lib/sector-colors";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Plus, MessageSquare, ExternalLink, Bookmark, BookmarkCheck, Loader2 } from "lucide-react";
import { MemoModal } from "@/components/memo/MemoModal";
import { CompletenessBadge, SignalScore, SourceCredibilityBadge } from "@/lib/article-signal";
import type { StoryData } from "@/components/dashboard";
import type { BadgeVariant } from "@/components/ui/badge";

function sentimentToVariant(sentiment: string): BadgeVariant {
  switch (sentiment.toLowerCase()) {
    case "positive":
    case "bullish":
      return "bullish";
    case "negative":
    case "bearish":
      return "bearish";
    case "risk-off":
      return "risk-off";
    default:
      return "default";
  }
}

function sentimentLabel(sentiment: string): string {
  switch (sentiment.toLowerCase()) {
    case "positive":
    case "bullish":
      return "Bullish";
    case "negative":
    case "bearish":
      return "Bearish";
    case "risk-off":
      return "Risk-Off";
    default:
      return sentiment;
  }
}

interface FeedRowProps {
  story: StoryData;
  onBookmark?: (id: string) => void;
}

export function FeedRow({ story, onBookmark }: FeedRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [memoOpen, setMemoOpen] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [thesisLoading, setThesisLoading] = useState(false);
  const [thesisToast, setThesisToast] = useState("");
  const saved = story.saved ?? false;
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
        "hover:bg-parchment-mid",
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
            <Badge variant={sentimentToVariant(story.sentiment)}>
              {sentimentLabel(story.sentiment)}
            </Badge>
            <div className="flex flex-wrap gap-1.5">
              {/* Industry Vertical Pills */}
              {(story.industry_verticals ?? []).length > 0
                ? (story.industry_verticals ?? []).map((v) => {
                    const style = getVerticalStyle(v)
                    return (
                      <span
                        key={v}
                        style={{
                          backgroundColor: style.bg,
                          color: style.text,
                          border: `1px solid ${style.border}`,
                          borderRadius: "3px",
                        }}
                        className="inline-flex items-center px-2 py-0.5 text-xs font-medium"
                      >
                        {v}
                      </span>
                    )
                  })
                : story.sector
                ? (
                    <span
                      style={getSectorStyle(story.sector)}
                      className="font-sans text-[9px] font-semibold px-2 py-0.5 rounded uppercase tracking-wide"
                    >
                      {story.sector}
                    </span>
                  )
                : null
              }
              {/* Activity Type Pills */}
              {(story.activity_types ?? []).map((a) => {
                const style = getActivityTypeStyle(a)
                return (
                  <span
                    key={a}
                    style={{
                      backgroundColor: style.bg,
                      color: style.text,
                      border: `1px solid ${style.border}`,
                      borderRadius: "3px",
                    }}
                    className="inline-flex items-center px-2 py-0.5 text-xs font-medium"
                  >
                    {a}
                  </span>
                )
              })}
            </div>
            <span className="font-sans text-[11px] text-text-muted font-medium">
              {story.source}
            </span>
            <span className="font-data text-[10px] text-text-faint ml-auto flex-shrink-0">
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
                {stripHtml(story.summary)}
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
              <div className="relative">
                <button
                  type="button"
                  disabled={thesisLoading}
                  onClick={async () => {
                    setThesisLoading(true);
                    setThesisToast("");
                    try {
                      const supabase = createBrowserClient(
                        process.env.NEXT_PUBLIC_SUPABASE_URL!,
                        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
                      );
                      const { data: theses } = await supabase
                        .from("theses")
                        .select("id, sector, title")
                        .neq("status", "archived");

                      const sector = (story.industry_verticals?.[0] ?? story.sector ?? "").toLowerCase();
                      const match = theses?.find(
                        (t) => (t.sector || "").toLowerCase() === sector,
                      );

                      if (match) {
                        router.push(`/thesis-board?thesis=${match.id}`);
                      } else {
                        setThesisToast("No thesis yet — this article hasn't been linked to a thesis");
                        setTimeout(() => setThesisToast(""), 3000);
                      }
                    } catch (err) {
                      console.error("Thesis match error:", err);
                    } finally {
                      setThesisLoading(false);
                    }
                  }}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-parchment border border-border-base font-sans text-[11px] font-medium text-text-secondary hover:border-border-hover transition-colors cursor-pointer",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                  )}
                >
                  {thesisLoading ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                  Thesis
                </button>
                {thesisToast && (
                  <div className="absolute -top-8 left-0 whitespace-nowrap bg-espresso text-cream font-sans text-[10px] px-2.5 py-1 rounded-md z-10">
                    {thesisToast}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
                }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-parchment border border-border-base font-sans text-[11px] font-medium text-text-secondary hover:border-border-hover transition-colors cursor-pointer"
              >
                <MessageSquare size={11} />
                Ask AI
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
      <MemoModal
        isOpen={memoOpen}
        onClose={() => setMemoOpen(false)}
        title={story.title}
        content={[story.title, stripHtml(story.summary)].join("\n\n")}
        type="article"
      />
    </div>
  );
}

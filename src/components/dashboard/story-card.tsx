"use client";

import { cn } from "@/lib/utils";
import { stripHtml } from "@/lib/strip-html";
import { withCompanyLine } from "@/lib/memo-company-line";
import { makeCallLink } from "@/lib/make-call-link";
import { useState, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  getSectorStyle,
  getTagPillStyle,
} from "@/lib/sector-colors";
import { SentimentPill, sentimentToTone } from "@/components/ui/sentiment-pill";
import { BookmarkButton } from "@/components/ui/bookmark";
import { Sparkles, Plus, MessageSquare, ExternalLink } from "lucide-react";
import { MemoModal } from "@/components/memo/MemoModal";
import { HeroPeers } from "@/components/dashboard/hero-peers";
import { HeroThread } from "@/components/dashboard/hero-thread";
import type { Completeness } from "@/lib/article-signal";
import { CompletenessBadge, SourceCredibilityBadge } from "@/lib/article-signal";

export interface StoryData {
  id: string;
  title: string;
  source: string;
  timestamp: string;
  sentiment: string;
  sector?: string;
  industry_verticals?: string[];
  activity_types?: string[];
  summary?: string;
  tags?: string[];
  /**
   * Company names from articles.companies, unsliced. Distinct from `tags`
   * (display-capped at 3) so memo grading metadata does not depend on a
   * display concern. companies[0] is threaded into memo prompts as a
   * COMPANY: line, persisted to outputs.content.target_company.
   */
  companies?: string[];
  url?: string;
  read?: boolean;
  saved?: boolean;
  completeness?: Completeness;
  adjustedScore?: number | null;
  sourceWinRate?: number | null;
  sourceSampleSize?: number | null;
  /**
   * Per-article "why it matters" rationales (articles.sentiment_reason /
   * relevance_reason). Rendered as bullets only in the hero variant; either or
   * both may be absent, in which case the block is hidden (no placeholder).
   */
  sentimentReason?: string;
  relevanceReason?: string;
  /** Ticker parsed from a Google-News source label, for the hero peer bars. */
  sourceTicker?: string | null;
}


interface LeadStoryCardProps {
  story: StoryData;
  onBookmark?: (id: string, saved: boolean) => void;
  /** "hero" renders the immersive dark ember lead tile (dashboard). Default
   *  keeps the light card used on landing/preview. */
  variant?: "default" | "hero";
  /** Hero-only: node rendered at the bottom of the ember tile (the rotating
   *  rundown strip). Sits outside the per-story fade so only its highlight
   *  changes as stories rotate. */
  footer?: ReactNode;
  /** Hero-only: hover/focus enters ("hold") and leaves the tile, so a parent
   *  rotator can pause and resume auto-advance. */
  onHoldStart?: () => void;
  onHoldEnd?: () => void;
}

export function LeadStoryCard({
  story,
  onBookmark,
  variant = "default",
  footer,
  onHoldStart,
  onHoldEnd,
}: LeadStoryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [saved, setSaved] = useState(story.saved ?? false);
  const [memoOpen, setMemoOpen] = useState(false);
  const router = useRouter();
  const hero = variant === "hero";

  // Extracted so the default and hero layouts share one implementation.
  const persistBookmark = (v: boolean) => {
    setSaved(v);
    onBookmark?.(story.id, v);
    const key = "signalera_reading_list";
    const list: string[] = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (v && !list.includes(story.id)) list.push(story.id);
    else if (!v) {
      const idx = list.indexOf(story.id);
      if (idx > -1) list.splice(idx, 1);
    }
    localStorage.setItem(key, JSON.stringify(list));
  };

  // Option A consolidation: the story action MAKES A CALL. It routes into the
  // author flow pre-filled with the headline; the LLM proposes symbol,
  // direction and window and the user edits all of it before committing.
  const makeCall = (e: React.MouseEvent) => {
    e.stopPropagation();
    router.push(makeCallLink(story.title));
  };

  // Shared action row (Bookmark / Generate Memo / Thesis / Ask AI). Dark-aware.
  const actions = (
    <div className="flex items-center gap-2 mt-3">
      <BookmarkButton saved={saved} onToggle={persistBookmark} />
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
        onClick={makeCall}
          className={cn(
            "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-sans text-[11px] font-medium transition-colors cursor-pointer",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            hero
              ? "bg-white/5 border border-[rgba(212,168,75,0.3)] text-[#e8c169] hover:border-[rgba(212,168,75,0.6)]"
              : "bg-parchment-mid border border-border-base text-text-secondary hover:border-border-hover",
          )}
        >
          <Plus size={11} />
        Make a call
      </button>
      <button
        type="button"
        disabled
        title="Ask AI is coming soon"
        className={cn(
          "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-sans text-[11px] font-medium cursor-not-allowed",
          hero
            ? "bg-white/5 border border-white/10 text-[#8a7d63] opacity-70"
            : "bg-parchment-mid border border-border-base text-text-faint opacity-60",
        )}
      >
        <MessageSquare size={11} />
        Ask AI
        <span
          className={cn(
            "ml-1 px-1 py-0.5 rounded text-[8px] font-semibold",
            hero ? "bg-white/10 text-[#b9ad97]" : "bg-parchment-mid text-text-muted",
          )}
        >
          Soon
        </span>
      </button>
    </div>
  );

  if (hero) {
    return (
      <div
        className="dash-lead-hero relative rounded-2xl overflow-visible border-t-2 border-t-[rgba(212,168,75,0.5)] p-6 md:p-9"
        onMouseEnter={() => { setExpanded(true); onHoldStart?.(); }}
        onMouseLeave={() => { setExpanded(false); onHoldEnd?.(); }}
        onFocusCapture={() => onHoldStart?.()}
        onBlurCapture={() => onHoldEnd?.()}
      >
        {/* Per-story content — keyed on story id so it (and HeroPeers) fades and
            lifts in on each rotation, and peer bars re-resolve + count up. */}
        <div key={story.id} className="dash-hero-in">
        {/* Eyebrow */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <span className="inline-flex items-center gap-2 font-data text-[11px] tracking-[0.02em] text-[#e8c169]">
            <span className="track-record-pending-dot w-1.5 h-1.5 rounded-full bg-[#e05c5c]" />
            Today&rsquo;s lead
          </span>
          <span className="font-data text-[10.5px] text-[#8a7d63] tabular-nums whitespace-nowrap">
            {story.source} · {story.timestamp}
          </span>
        </div>

        {/* Sentiment + ticker chip + sector */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <SentimentPill tone={sentimentToTone(story.sentiment)} size="xs" />
          {story.tags?.[0] && (
            <span className="font-data text-[11px] px-2 py-0.5 rounded-full bg-[rgba(212,168,75,0.14)] border border-[rgba(212,168,75,0.3)] text-[#e8c169]">
              {story.tags[0]}
            </span>
          )}
          {story.sector && (
            <span className="font-data text-[10px] text-[#8a7d63]">{story.sector}</span>
          )}
        </div>

        {/* Body: headline + dek (+ peer bars) on the left, "why it matters" on
            the right. When both reasons are null the right column is dropped and
            the left content spans full width (dek gets the room). Peer bars
            render themselves only when real tickers resolve. */}
        {(() => {
          const reasons = [story.sentimentReason, story.relevanceReason]
            .map((r) => (r ?? "").trim())
            .filter(Boolean);
          const hasWhy = reasons.length > 0;
          return (
            <div className={cn("grid gap-x-8 gap-y-5", hasWhy && "md:grid-cols-[1.6fr_1fr]")}>
              <div className="flex flex-col min-w-0">
                <h3 className="font-display text-[24px] md:text-[30px] font-medium text-[#f6ecdb] leading-[1.12] tracking-[-0.02em] text-wrap-pretty m-0">
                  {story.title}
                </h3>
                {story.summary && (
                  <p className="font-display italic text-[15px] text-[#b9ad97] mt-3 leading-[1.5] max-w-[70ch]">
                    {stripHtml(story.summary)}
                  </p>
                )}
                <HeroPeers sourceTicker={story.sourceTicker} companies={story.companies} />
              </div>

              {hasWhy && (
                <div className="flex flex-col justify-center md:border-l md:border-[rgba(212,168,75,0.12)] md:pl-7">
                  <p className="font-data text-[10.5px] tracking-[0.02em] text-[#e8c169] m-0 mb-3">
                    Why it matters
                  </p>
                  <div className="flex flex-col gap-4">
                    {reasons.map((r, i) => (
                      <div key={i} className="flex gap-2.5 items-start">
                        <span className="w-[13px] h-[2px] rounded-[2px] bg-[#d4a84b] mt-[9px] shrink-0" />
                        <p className="font-display text-[15px] leading-[1.5] text-[#eaddc6] m-0">
                          {r}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {actions}

        {story.url && (
          <a
            href={story.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 font-data text-[11px] text-[#e8c169] hover:text-[#f6ecdb] transition-colors mt-4"
          >
            Read the full story
            <ExternalLink size={11} />
          </a>
        )}

        {/* In this thread — stored-embedding nearest neighbors; hides itself
            when the RPC returns nothing. */}
        <HeroThread storyId={story.id} />
        </div>

        {footer}

        <MemoModal
          isOpen={memoOpen}
          onClose={() => setMemoOpen(false)}
          title={story.title}
          content={withCompanyLine([story.title, stripHtml(story.summary)].join("\n\n"), story.companies?.[0])}
          type="article"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative bg-white border border-border-base rounded-2xl overflow-visible",
        "transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
        "hover:-translate-y-0.5 hover:border-border-hover hover:shadow-[0_2px_12px_rgba(201,146,42,0.06)]",
        !story.read && "border-l-[3px] border-l-gold",
      )}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      <div className="px-4 pt-4 pb-3">
        {/* Meta row */}
        <div className="flex items-center gap-2 mb-2">
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
            {/* Activity Type Pills — keep semantic colors */}
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
          <span className="font-sans text-[10px] text-text-faint ml-auto">
            {story.timestamp}
          </span>
          <CompletenessBadge completeness={story.completeness} />
          <SourceCredibilityBadge winRate={story.sourceWinRate} sampleSize={story.sourceSampleSize} />
          {story.url && (
            <a
              href={story.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 font-sans text-[10px] font-medium text-text-muted hover:text-text-primary transition-colors"
            >
              <ExternalLink size={10} />
              Source
            </a>
          )}
        </div>

        {/* Headline */}
        <h3 className="font-[family-name:var(--font-playfair-display)] text-[15px] font-bold text-espresso leading-snug hover:text-gold-dark transition-colors">
          {story.title}
        </h3>

        {/* Summary (visible on hover) */}
        <div
          className={cn(
            "overflow-hidden transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
            expanded ? "max-h-40 opacity-100 mt-2" : "max-h-0 opacity-0 mt-0",
          )}
        >
          {story.summary && (
            <p className="font-sans text-[12px] text-text-secondary leading-[1.55]">
              {stripHtml(story.summary)}
            </p>
          )}

          {/* Tags */}
          {story.tags && story.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {story.tags.map((tag) => (
                <span
                  key={tag}
                  className="font-sans text-[10px] px-2 py-0.5 bg-parchment-mid border border-border-base rounded-md text-text-muted"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Action buttons */}
          {actions}
        </div>
      </div>
      <MemoModal
        isOpen={memoOpen}
        onClose={() => setMemoOpen(false)}
        title={story.title}
        content={withCompanyLine([story.title, stripHtml(story.summary)].join("\n\n"), story.companies?.[0])}
        type="article"
      />
    </div>
  );
}

interface CompactStoryCardProps {
  story: StoryData;
  number: number;
  onBookmark?: (id: string, saved: boolean) => void;
}

export function CompactStoryCard({ story, number, onBookmark }: CompactStoryCardProps) {
  const [saved, setSaved] = useState(story.saved ?? false);
  const [expanded, setExpanded] = useState(false);
  const [memoOpen, setMemoOpen] = useState(false);
  const router = useRouter();

  // Reset expanded when story changes
  useEffect(() => {
    setExpanded(false);
  }, [story.id]);

  return (
    <div
      className={cn(
        "py-3 px-3 rounded-xl group cursor-pointer",
        "transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
        expanded ? "bg-parchment-mid" : "hover:translate-x-0.5 hover:bg-parchment-mid",
        story.read && "opacity-72",
      )}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      <div className="flex items-start gap-3">
        {/* Unread indicator */}
        {!story.read && (
          <div className="w-[3px] self-stretch rounded-full bg-gold flex-shrink-0 -ml-1 mr-0" />
        )}

        {/* Number */}
        <span className="font-display text-[22px] font-extrabold text-border-base leading-none flex-shrink-0 w-6 text-right">
          {number}
        </span>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
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
                      className="font-sans text-[9px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0"
                    >
                      {story.sector}
                    </span>
                  )
                : null
              }
              {/* Activity Type Pills — keep semantic colors */}
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
            <span className="font-sans text-[10px] text-text-muted">
              {story.source}
            </span>
            <span className="font-sans text-[9px] text-text-faint ml-auto">
              {story.timestamp}
            </span>
            <CompletenessBadge completeness={story.completeness} />
            <SourceCredibilityBadge winRate={story.sourceWinRate} sampleSize={story.sourceSampleSize} />
            {story.url && (
              <a
                href={story.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 font-sans text-[9px] font-medium text-text-muted hover:text-text-primary transition-colors"
              >
                <ExternalLink size={9} />
                Source
              </a>
            )}
          </div>
          <h4 className="font-[family-name:var(--font-playfair-display)] text-[13px] font-bold text-espresso leading-snug hover:text-gold-dark transition-colors">
            {story.title}
          </h4>

          {/* Expanded content */}
          <div
            className={cn(
              "overflow-hidden transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
              expanded ? "max-h-60 opacity-100 mt-2" : "max-h-0 opacity-0 mt-0",
            )}
          >
            {story.summary && (
              <p className="font-sans text-[12px] text-text-secondary leading-relaxed mb-3">
                {stripHtml(story.summary)}
              </p>
            )}

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMemoOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gold text-cream font-sans text-[11px] font-semibold hover:bg-gold-dark transition-colors cursor-pointer"
              >
                <Sparkles size={11} />
                Generate Memo
              </button>
              <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    router.push(makeCallLink(story.title));
                  }}
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
            </div>
          </div>
        </div>

        {/* Bookmark (visible on hover) */}
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <BookmarkButton
            saved={saved}
            size={12}
            onToggle={(v) => {
              setSaved(v);
              onBookmark?.(story.id, v);
              const key = "signalera_saved_articles";
              const list: string[] = JSON.parse(localStorage.getItem(key) ?? "[]");
              if (v && !list.includes(story.id)) list.push(story.id);
              else if (!v) { const idx = list.indexOf(story.id); if (idx > -1) list.splice(idx, 1); }
              localStorage.setItem(key, JSON.stringify(list));
            }}
          />
        </div>
      </div>
      <MemoModal
        isOpen={memoOpen}
        onClose={() => setMemoOpen(false)}
        title={story.title}
        content={withCompanyLine([story.title, stripHtml(story.summary)].join("\n\n"), story.companies?.[0])}
        type="article"
      />
    </div>
  );
}

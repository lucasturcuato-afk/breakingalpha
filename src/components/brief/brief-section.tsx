"use client";

import { cn } from "@/lib/utils";
import { stripHtml } from "@/lib/strip-html";
import { Sparkles, Plus, Loader2, ThumbsUp, ThumbsDown } from "lucide-react";
import { useOutputFeedback } from "@/hooks/useOutputFeedback";

interface BriefSectionProps {
  title: string;
  content: string;
  fullWidth?: boolean;
  accentColor?: "gold" | "violet";
  expanded?: boolean;
  onToggle?: () => void;
  onGenerateMemo?: () => void;
  onAddThesis?: () => void;
  addingThesis?: boolean;
  sectionKey?: string;
  onRate?: (sectionKey: string, rating: 1 | -1) => void;
  currentRating?: number;
  /** When true, tightens padding and body font by ~1px for side-quadrant typography tiering. */
  compact?: boolean;
  /** When true, root stretches to fill its parent's height (dashboard mode lead quadrant). */
  fillHeight?: boolean;
  /** Output tracking ID for implicit feedback collection. */
  outputId?: string | null;
}

export function BriefSection({
  title,
  content,
  fullWidth = false,
  accentColor = "gold",
  expanded = false,
  onToggle,
  onGenerateMemo,
  onAddThesis,
  addingThesis = false,
  sectionKey,
  onRate,
  currentRating = 0,
  compact = false,
  fillHeight = false,
  outputId,
}: BriefSectionProps) {
  const { ref: feedbackRef, setThumbs } = useOutputFeedback({ output_id: outputId });
  const cleanContent = stripHtml(content);

  const hasRating = currentRating !== 0;
  const showRating = Boolean(sectionKey && onRate);

  return (
    <div
      ref={feedbackRef as React.RefObject<HTMLDivElement>}
      onClick={onToggle}
      className={cn(
        "relative rounded-xl border border-border-base bg-white dark:bg-elevated dark:border-border-default group",
        compact ? "p-3 min-h-[140px]" : "p-4 min-h-[160px]",
        fullWidth && "col-span-2",
        fillHeight && "h-full",
        "cursor-pointer transition-all duration-200 hover:ring-1 hover:ring-gold/40 hover:shadow-sm",
      )}
    >
      <h3
        className={cn(
          "font-data text-[10px] uppercase tracking-widest font-bold mb-2.5",
          accentColor === "gold" ? "text-gold" : "text-signal-ai",
        )}
      >
        {title}
      </h3>

      {/* Content — full text always visible */}
      <p
        className={cn(
          "font-sans text-text-secondary dark:text-[#e8e8e4] leading-relaxed",
          compact ? "text-[12px]" : "text-[13px]",
        )}
      >
        {cleanContent}
      </p>

      {/* Section rating — fade-in thumbs, top-right, stay visible once rated */}
      {showRating && (
        <div
          className={cn(
            "absolute top-2 right-2 flex items-center gap-1 transition-opacity duration-200",
            hasRating ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRate?.(sectionKey as string, 1); setThumbs("up"); }}
            className={cn(
              "p-1 rounded transition-colors cursor-pointer",
              currentRating === 1
                ? "text-gold"
                : hasRating
                  ? "text-text-faint/50"
                  : "text-text-faint hover:text-gold",
            )}
            aria-label="Mark this section useful"
            title="Useful"
          >
            <ThumbsUp size={12} />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRate?.(sectionKey as string, -1); setThumbs("down"); }}
            className={cn(
              "p-1 rounded transition-colors cursor-pointer",
              currentRating === -1
                ? "text-gold"
                : hasRating
                  ? "text-text-faint/50"
                  : "text-text-faint hover:text-gold",
            )}
            aria-label="Mark this section not useful"
            title="Not useful"
          >
            <ThumbsDown size={12} />
          </button>
        </div>
      )}

      {/* Expanded: action buttons */}
      <div
        className={cn(
          "overflow-hidden transition-all duration-200 ease-out",
          expanded ? "max-h-24 opacity-100 mt-3" : "max-h-0 opacity-0 mt-0",
        )}
      >
        <div className="flex items-center gap-2">
          {onGenerateMemo && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onGenerateMemo();
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gold text-cream font-sans text-[11px] font-semibold hover:bg-gold-dark transition-colors cursor-pointer"
            >
              <Sparkles size={11} />
              Generate Memo
            </button>
          )}
          {onAddThesis && (
            <button
              type="button"
              disabled={addingThesis}
              onClick={(e) => {
                e.stopPropagation();
                onAddThesis();
              }}
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-parchment-mid border border-border-base font-sans text-[11px] font-medium text-text-secondary hover:border-border-hover transition-colors cursor-pointer",
                "disabled:opacity-50 disabled:cursor-not-allowed",
              )}
            >
              {addingThesis ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
              {addingThesis ? "Adding..." : "Thesis"}
            </button>
          )}
        </div>
      </div>

      {/* Collapsed: hover hint */}
      {!expanded && (
        <div className="mt-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <span className="font-sans text-[10px] text-text-faint">
            Generate memo &rarr;
          </span>
        </div>
      )}
    </div>
  );
}

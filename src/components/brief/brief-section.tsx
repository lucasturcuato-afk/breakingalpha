"use client";

import { cn } from "@/lib/utils";
import { stripHtml } from "@/lib/strip-html";
import { Sparkles, Plus, Loader2 } from "lucide-react";

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
}: BriefSectionProps) {
  const cleanContent = stripHtml(content);

  return (
    <div
      onClick={onToggle}
      className={cn(
        "p-4 rounded-xl border border-border-base bg-white dark:bg-elevated dark:border-border-default group min-h-[160px]",
        fullWidth && "col-span-2",
        "cursor-pointer transition-all duration-200 hover:ring-1 hover:ring-gold/40 hover:shadow-sm",
      )}
    >
      <h3
        className={cn(
          "font-sans text-[10px] uppercase tracking-widest font-bold mb-2",
          accentColor === "gold" ? "text-gold" : "text-signal-ai",
        )}
      >
        {title}
      </h3>

      {/* Content — full text always visible */}
      <p className="font-sans text-[13px] text-text-secondary dark:text-[#e8e8e4] leading-[1.72]">
        {cleanContent}
      </p>

      {/* Section rating */}
      {sectionKey && onRate && (
        <div className="flex items-center gap-2 mt-3 pt-2 border-t border-border-subtle">
          <span className="font-sans text-[9px] text-text-faint uppercase tracking-wider">Useful?</span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRate(sectionKey, 1); }}
            className={cn(
              "p-1 rounded transition-colors cursor-pointer",
              currentRating === 1 ? "text-signal-up bg-signal-up/10" : "text-text-faint hover:text-signal-up",
            )}
            title="This section was useful"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z"/></svg>
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRate(sectionKey, -1); }}
            className={cn(
              "p-1 rounded transition-colors cursor-pointer",
              currentRating === -1 ? "text-signal-dn bg-signal-dn/10" : "text-text-faint hover:text-signal-dn",
            )}
            title="This section wasn't useful"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22h0a3.13 3.13 0 0 1-3-3.88Z"/></svg>
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

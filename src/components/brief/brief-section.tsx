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
}: BriefSectionProps) {
  const cleanContent = stripHtml(content);

  return (
    <div
      onClick={onToggle}
      className={cn(
        "p-4 rounded-xl border border-border-base bg-white group min-h-[160px]",
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
      <p className="font-sans text-[13px] text-text-secondary leading-[1.72]">
        {cleanContent}
      </p>

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

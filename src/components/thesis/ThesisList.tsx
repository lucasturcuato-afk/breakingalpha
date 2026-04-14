"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { getSectorStyle } from "@/lib/sector-colors";
import { Check, X } from "lucide-react";
import type { ThesisItem } from "./thesis-types";
import { ConvictionRing } from "./ConvictionRing";

interface ThesisListProps {
  theses: ThesisItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  filter: string;
  isArchiveView?: boolean;
  onRestore?: (id: string) => void;
  isPendingReview?: boolean;
  onQuickAction?: (id: string, status: string) => void;
}

function convictionToSentiment(conviction: string): string {
  switch (conviction) {
    case "BULLISH": return "bullish";
    case "BEARISH": return "bearish";
    case "WATCH": return "watch";
    default: return "watch";
  }
}

function deriveScore(thesis: ThesisItem): number | null {
  if (typeof thesis.adversarial_score === "number") {
    if (thesis.adversarial_score < 0) return null;
    return Math.round(thesis.adversarial_score * 100);
  }
  const base = thesis.conviction === "BULLISH" ? 80 : thesis.conviction === "BEARISH" ? 30 : 55;
  const evidenceBonus = Math.min((Array.isArray(thesis.evidence_chain) ? thesis.evidence_chain.length : 0) * 5, 15);
  return base + evidenceBonus;
}

export function ThesisList({
  theses,
  selectedId,
  onSelect,
  filter,
  isArchiveView,
  onRestore,
  isPendingReview,
  onQuickAction,
}: ThesisListProps) {
  const filtered = useMemo(() => {
    if (isArchiveView) {
      return [...theses].sort((a, b) => (deriveScore(b) ?? -1) - (deriveScore(a) ?? -1));
    }
    let list = theses;
    if (filter !== "all" && filter !== "pending_review") {
      list = list.filter((t) => convictionToSentiment(t.conviction) === filter);
    }
    return [...list].sort((a, b) => (deriveScore(b) ?? -1) - (deriveScore(a) ?? -1));
  }, [theses, filter, isArchiveView]);

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="font-sans text-[12px] text-text-muted">No theses match this filter</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {filtered.map((thesis) => {
        const score = deriveScore(thesis);
        const sentiment = convictionToSentiment(thesis.conviction);
        const isSelected = thesis.id === selectedId;
        const hasEvidence = Array.isArray(thesis.evidence_chain) && thesis.evidence_chain.length > 0;
        const isBearishLow = sentiment === "bearish" && (score ?? 0) < 50;

        return (
          <div
            key={thesis.id}
            onClick={() => onSelect(thesis.id)}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all group",
              isSelected
                ? "bg-parchment-mid border-l-2 border-gold"
                : "hover:bg-parchment-mid/60 border-l-2 border-transparent",
            )}
          >
            {/* Conviction ring */}
            <ConvictionRing score={score} />

            {/* Title + badges */}
            <div className="flex-1 min-w-0">
              <p className="font-display text-[13px] font-bold text-espresso leading-snug truncate">
                {thesis.title}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span
                  className={cn(
                    "text-[9px] px-1.5 py-0.5 rounded font-medium",
                    sentiment === "bullish" && "bg-signal-up/10 text-signal-up",
                    sentiment === "bearish" && "bg-signal-dn/10 text-signal-dn",
                    sentiment === "watch" && "bg-signal-warn/10 text-signal-warn",
                  )}
                >
                  {thesis.conviction}
                </span>
                <span
                  style={getSectorStyle(thesis.sector)}
                  className="font-sans text-[9px] font-semibold px-2 py-0.5 rounded uppercase tracking-wide"
                >
                  {thesis.sector}
                </span>
                {thesis.ticker && (
                  <span className="font-data text-[9px] text-gold-dark">
                    {thesis.ticker}
                  </span>
                )}
                {isArchiveView && (
                  <span className="font-sans text-[9px] text-text-muted italic">Archived</span>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex-shrink-0 flex items-center gap-1.5">
              {isPendingReview && onQuickAction ? (
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onQuickAction(thesis.id, "active");
                    }}
                    className="p-1 rounded-md bg-signal-up/10 hover:bg-signal-up/20 transition-colors cursor-pointer"
                    aria-label="Approve"
                    title="Approve"
                  >
                    <Check size={10} className="text-signal-up" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onQuickAction(thesis.id, "archived");
                    }}
                    className="p-1 rounded-md bg-signal-dn/10 hover:bg-signal-dn/20 transition-colors cursor-pointer"
                    aria-label="Dismiss"
                    title="Dismiss"
                  >
                    <X size={10} className="text-signal-dn" />
                  </button>
                </div>
              ) : onRestore ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRestore(thesis.id);
                  }}
                  className="font-sans text-[9px] px-2 py-0.5 rounded border border-border-base hover:border-gold hover:text-gold text-text-muted transition-colors cursor-pointer"
                >
                  Restore
                </button>
              ) : (
                <div className="w-2">
                  {hasEvidence ? (
                    <div className="w-2 h-2 rounded-full bg-signal-up" />
                  ) : isBearishLow ? (
                    <div className="w-2 h-2 rounded-full bg-signal-dn" />
                  ) : null}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

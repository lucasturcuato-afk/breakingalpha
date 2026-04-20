"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { getSectorStyle } from "@/lib/sector-colors";
import { Check, X } from "lucide-react";
import type { ThesisItem } from "./thesis-types";
import { ConvictionRing } from "./ConvictionRing";
import { useUserProfile } from "@/hooks/useUserProfile";
import { isOnWatchlist } from "@/lib/personalization";

interface ThesisListProps {
  theses: ThesisItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  filter: string;
  isArchiveView?: boolean;
  onRestore?: (id: string) => void;
  isPendingReview?: boolean;
  onQuickAction?: (id: string, status: string) => void;
  matchedSectors?: string[];
}

function convictionToSentiment(conviction: string | null): string {
  switch (conviction) {
    case "HIGH":
    case "BULLISH": return "bullish";
    case "BEARISH": return "bearish";
    case "MEDIUM":
    case "WATCH": return "watch";
    default: return "watch";
  }
}

// Conviction-ordering weight — used ONLY for sort stability. Hard Constraint
// #11 forbids surfacing any numeric score in the UI; this never leaves this
// module.
function convictionRank(thesis: ThesisItem): number {
  const c = thesis.conviction;
  if (c === "HIGH" || c === "BULLISH") return 3;
  if (c === "MEDIUM") return 2;
  if (c === "WATCH") return 1;
  if (c === "BEARISH") return 0;
  return -1;
}

function isSectorMatched(thesisSector: string, sectors: string[]): boolean {
  const lower = thesisSector.toLowerCase();
  return sectors.some((s) => {
    const sl = s.toLowerCase();
    return lower.includes(sl) || sl.includes(lower);
  });
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
  matchedSectors,
}: ThesisListProps) {
  const { profile } = useUserProfile();

  const filtered = useMemo(() => {
    if (isArchiveView) {
      return [...theses].sort((a, b) => convictionRank(b) - convictionRank(a));
    }
    let list = theses;
    if (filter !== "all" && filter !== "pending_review") {
      list = list.filter((t) => convictionToSentiment(t.conviction) === filter);
    }
    return [...list].sort((a, b) => convictionRank(b) - convictionRank(a));
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
        const sentiment = convictionToSentiment(thesis.conviction);
        const isSelected = thesis.id === selectedId;
        const hasEvidence = Array.isArray(thesis.evidence_chain) && thesis.evidence_chain.length > 0;
        const isBearish = sentiment === "bearish";

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
            <ConvictionRing conviction={thesis.conviction} />

            {/* Title + badges */}
            <div className="flex-1 min-w-0">
              <p className="font-display text-[13px] font-bold text-espresso leading-snug truncate">
                {thesis.title}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
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
              {matchedSectors && matchedSectors.length > 0 && isSectorMatched(thesis.sector, matchedSectors) && (
                <p className="font-sans text-[9px] text-gold-dark mt-0.5">Matched to your sectors</p>
              )}
              {thesis.ticker && isOnWatchlist(thesis.ticker, profile) && (
                <span className="inline-flex items-center font-sans text-[9px] font-semibold text-gold bg-gold-muted border border-gold/20 rounded px-1 py-0 mt-0.5">
                  Watching
                </span>
              )}
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
                  ) : isBearish ? (
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

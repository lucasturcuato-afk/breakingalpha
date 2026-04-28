"use client";

import { useMemo, useState } from "react";
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
  const [expandedTickerGroups, setExpandedTickerGroups] = useState<Set<string>>(new Set());

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

  const groupedDisplay = useMemo(() => {
    const tickerGroups = new Map<string, ThesisItem[]>();
    const standalone: ThesisItem[] = [];

    for (const t of filtered) {
      const ticker = (t.ticker ?? "").trim().toUpperCase();
      if (!ticker) {
        standalone.push(t);
        continue;
      }
      const arr = tickerGroups.get(ticker) ?? [];
      arr.push(t);
      tickerGroups.set(ticker, arr);
    }

    const result: { primary: ThesisItem; others: ThesisItem[] }[] = [];

    for (const t of standalone) {
      result.push({ primary: t, others: [] });
    }

    for (const arr of tickerGroups.values()) {
      arr.sort((a, b) => {
        const rankDiff = convictionRank(b) - convictionRank(a);
        if (rankDiff !== 0) return rankDiff;
        return new Date(b.generated_at ?? 0).getTime() - new Date(a.generated_at ?? 0).getTime();
      });
      result.push({ primary: arr[0], others: arr.slice(1) });
    }

    // Sort all entries by primary conviction rank (descending)
    result.sort((a, b) => convictionRank(b.primary) - convictionRank(a.primary));

    return result;
  }, [filtered]);

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="font-sans text-[12px] text-text-muted">No theses match this filter</p>
      </div>
    );
  }

  function renderThesisRow(thesis: ThesisItem, indent = false) {
    const sentiment = convictionToSentiment(thesis.conviction);
    const isSelected = thesis.id === selectedId;
    const hasEvidence = Array.isArray(thesis.evidence_chain) && thesis.evidence_chain.length > 0;
    const isBearish = sentiment === "bearish";

    return (
      <div
        key={thesis.id}
        onClick={() => onSelect(thesis.id)}
        style={indent ? { opacity: 0.85, paddingLeft: 32 } : undefined}
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
  }

  return (
    <div className="space-y-1">
      {groupedDisplay.map(({ primary, others }) => {
        const ticker = (primary.ticker ?? "").trim().toUpperCase();
        const isExpanded = expandedTickerGroups.has(ticker);

        return (
          <div key={primary.id}>
            {renderThesisRow(primary)}
            {others.length > 0 && (
              <div className="ml-12 mt-0.5 mb-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedTickerGroups((prev) => {
                      const next = new Set(prev);
                      if (next.has(ticker)) next.delete(ticker);
                      else next.add(ticker);
                      return next;
                    });
                  }}
                  className="inline-flex items-center font-sans text-[9px] font-semibold text-gold-dark bg-gold-muted/50 border border-gold/15 rounded px-1.5 py-0 mt-0.5 cursor-pointer hover:bg-gold-muted transition-colors"
                >
                  {isExpanded ? "▴" : "▾"} +{others.length} related
                </button>
              </div>
            )}
            {isExpanded && others.map((t) => renderThesisRow(t, true))}
          </div>
        );
      })}
    </div>
  );
}

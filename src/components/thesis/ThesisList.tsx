"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { getSectorStyle } from "@/lib/sector-colors";
import type { ThesisItem } from "./thesis-types";

interface ThesisListProps {
  theses: ThesisItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  filter: string;
  isArchiveView?: boolean;
  onRestore?: (id: string) => void;
}

function convictionToSentiment(conviction: string): string {
  switch (conviction) {
    case "BULLISH": return "bullish";
    case "BEARISH": return "bearish";
    case "WATCH": return "watch";
    default: return "watch";
  }
}

function deriveScore(thesis: ThesisItem): number {
  const base = thesis.conviction === "BULLISH" ? 80 : thesis.conviction === "BEARISH" ? 30 : 55;
  const evidenceBonus = Math.min((thesis.evidence_chain?.length ?? 0) * 5, 15);
  return base + evidenceBonus;
}

function SignalStrength({ score }: { score: number | null | undefined }) {
  const s = score ?? 50;
  const bars = 4;
  const filled = s >= 80 ? 4 : s >= 65 ? 3 : s >= 45 ? 2 : 1;
  const color = s >= 80 ? "#27ae60" : s >= 65 ? "#B8860B" : s >= 45 ? "#e67e22" : "#e74c3c";
  return (
    <div className="flex items-end gap-[2px] flex-shrink-0" title={`Conviction: ${s}/100`}>
      {Array.from({ length: bars }).map((_, i) => (
        <div
          key={i}
          style={{
            width: 3,
            height: 5 + i * 3,
            borderRadius: 1,
            background: i < filled ? color : "var(--color-border-base)",
          }}
        />
      ))}
    </div>
  );
}

export function ThesisList({ theses, selectedId, onSelect, filter, isArchiveView, onRestore }: ThesisListProps) {
  const filtered = useMemo(() => {
    // Archive view: show all archived theses, skip conviction filter
    if (isArchiveView) {
      return [...theses].sort((a, b) => deriveScore(b) - deriveScore(a));
    }
    let list = theses;
    if (filter !== "all") {
      list = list.filter((t) => convictionToSentiment(t.conviction) === filter);
    }
    return [...list].sort((a, b) => deriveScore(b) - deriveScore(a));
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
        const hasEvidence = (thesis.evidence_chain?.length ?? 0) > 0;
        const isBearishLow = sentiment === "bearish" && score < 50;

        return (
          <div
            key={thesis.id}
            onClick={() => onSelect(thesis.id)}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all",
              isSelected
                ? "bg-parchment-mid border-l-2 border-gold"
                : "hover:bg-parchment-mid/60 border-l-2 border-transparent",
            )}
          >
            {/* Signal strength */}
            <SignalStrength score={score} />

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
                {isArchiveView && (
                  <span className="font-sans text-[9px] text-text-muted italic">Archived</span>
                )}
              </div>
            </div>

            {/* Indicator dot / Restore */}
            <div className="flex-shrink-0 flex items-center gap-1.5">
              {onRestore ? (
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
                    <div className="w-2 h-2 rounded-full bg-green-400" />
                  ) : isBearishLow ? (
                    <div className="w-2 h-2 rounded-full bg-red-400" />
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

"use client";

// BriefWatch (PR-C1a): "03 Watch" body row, structured items. Each item is a
// card with a thesis_path chip (bull/bear), description (CitedText), and a
// probability chip. testid `brief-watch-item-{thesis_path}` per card.

import type { MemoWatchItem } from "@/lib/memo-schema";
import { CitedText } from "@/components/ui/cited-text";
import { cn } from "@/lib/utils";

interface BriefWatchProps {
  items: MemoWatchItem[];
  sourceCount: number;
  onCiteClick: (n: number) => void;
}

const thesisStyles: Record<MemoWatchItem["thesis_path"], string> = {
  bull: "bg-signal-up/10 text-signal-up border-signal-up/30",
  bear: "bg-signal-dn/10 text-signal-dn border-signal-dn/30",
};

const thesisLabel: Record<MemoWatchItem["thesis_path"], string> = {
  bull: "Bull",
  bear: "Bear",
};

const probabilityStyles: Record<MemoWatchItem["probability"], string> = {
  low: "bg-text-faint/10 text-text-faint border-text-faint/30",
  medium: "bg-text-muted/10 text-text-muted border-text-muted/30",
  high: "bg-gold/10 text-gold border-gold/30",
};

export function BriefWatch({ items, sourceCount, onCiteClick }: BriefWatchProps) {
  if (!items || items.length === 0) return null;
  return (
    <div data-testid="brief-watch" className="flex gap-3 mb-3">
      <span className="font-data text-[9px] font-bold uppercase tracking-[0.10em] text-text-faint w-[60px] shrink-0 pt-1">
        03 · Watch
      </span>
      <div className="flex-1 space-y-3">
        {items.map((item, i) => (
          <div
            key={i}
            data-testid={`brief-watch-item-${item.thesis_path}`}
            className="rounded-md border border-border-base bg-cream p-3"
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <span
                className={cn(
                  "inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.10em] border",
                  thesisStyles[item.thesis_path],
                )}
              >
                {thesisLabel[item.thesis_path]}
              </span>
              <span
                className={cn(
                  "inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.10em] border",
                  probabilityStyles[item.probability],
                )}
              >
                {item.probability}
              </span>
            </div>
            <p className="font-sans text-[13px] leading-relaxed text-text-primary m-0">
              <CitedText
                sourceCount={sourceCount}
                onCiteClick={onCiteClick}
                citeTestIdPrefix="brief"
              >
                {item.description}
              </CitedText>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

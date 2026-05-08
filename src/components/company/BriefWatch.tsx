"use client";

// BriefWatch (PR-C1): "03 Watch" body row. brief-watch-item lands on the
// inner <p> (single-paragraph schema, list-of-one selector for smoke tests).

import { CitedText } from "@/components/ui/cited-text";

interface BriefWatchProps {
  text: string;
  sourceCount: number;
  onCiteClick: (n: number) => void;
}

export function BriefWatch({ text, sourceCount, onCiteClick }: BriefWatchProps) {
  return (
    <div data-testid="brief-watch" className="flex gap-3 mb-3">
      <span className="font-data text-[9px] font-bold uppercase tracking-[0.10em] text-text-faint w-[60px] shrink-0 pt-1">
        03 · Watch
      </span>
      <p
        data-testid="brief-watch-item"
        className="font-sans text-[13px] leading-relaxed text-text-primary m-0 flex-1"
      >
        <CitedText
          sourceCount={sourceCount}
          onCiteClick={onCiteClick}
          citeTestIdPrefix="brief"
        >
          {text}
        </CitedText>
      </p>
    </div>
  );
}

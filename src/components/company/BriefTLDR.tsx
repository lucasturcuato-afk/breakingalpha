"use client";

// BriefTLDR (PR-C1): gold-faint callout box rendering memo.tldr. Mirrors
// docs/DirectionD.jsx 668-677. tldr is a single string per schema, so
// brief-tldr-item lands on the inner <p> as a list-of-one.

import { CitedText } from "@/components/ui/cited-text";

interface BriefTLDRProps {
  tldr: string;
  sourceCount: number;
  onCiteClick: (n: number) => void;
}

export function BriefTLDR({ tldr, sourceCount, onCiteClick }: BriefTLDRProps) {
  return (
    <div
      data-testid="brief-tldr"
      className="rounded-md border border-gold/40 bg-gold-muted px-[14px] py-[11px] mb-[14px]"
    >
      <div className="font-data text-[9px] font-bold uppercase tracking-[0.12em] text-gold mb-[5px]">
        TLDR
      </div>
      <p
        data-testid="brief-tldr-item"
        className="font-sans text-[13px] leading-relaxed text-text-primary m-0"
      >
        <CitedText
          sourceCount={sourceCount}
          onCiteClick={onCiteClick}
          citeTestIdPrefix="brief"
        >
          {tldr}
        </CitedText>
      </p>
    </div>
  );
}

"use client";

// BriefLead (PR-C1): "01 Lead" body row. Mirrors DirectionD.jsx 680-696.

import { CitedText } from "@/components/ui/cited-text";

interface BriefLeadProps {
  text: string;
  sourceCount: number;
  onCiteClick: (n: number) => void;
}

export function BriefLead({ text, sourceCount, onCiteClick }: BriefLeadProps) {
  return (
    <div data-testid="brief-lead" className="flex gap-3 mb-3">
      <span className="font-data text-[9px] font-bold uppercase tracking-[0.10em] text-text-faint w-[60px] shrink-0 pt-1">
        01 · Lead
      </span>
      <p className="font-sans text-[13px] leading-relaxed text-text-primary m-0 flex-1">
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

"use client";

// BriefLead (PR-C1a): "01 Lead" body row, multi-paragraph. Renders one <p>
// per element of memo.lead.paragraphs with [n] markers parsed by CitedText.

import { CitedText } from "@/components/ui/cited-text";

interface BriefLeadProps {
  paragraphs: string[];
  sourceCount: number;
  onCiteClick: (n: number) => void;
}

export function BriefLead({ paragraphs, sourceCount, onCiteClick }: BriefLeadProps) {
  if (!paragraphs || paragraphs.length === 0) return null;
  return (
    <div data-testid="brief-lead" className="flex gap-3 mb-3">
      <span className="font-data text-[9px] font-bold uppercase tracking-[0.10em] text-text-faint w-[60px] shrink-0 pt-1">
        01 · Lead
      </span>
      <div className="flex-1 space-y-3">
        {paragraphs.map((text, i) => (
          <p
            key={i}
            data-testid="brief-lead-paragraph"
            className="font-sans text-[13px] leading-relaxed text-text-primary m-0"
          >
            <CitedText
              sourceCount={sourceCount}
              onCiteClick={onCiteClick}
              citeTestIdPrefix="brief"
            >
              {text}
            </CitedText>
          </p>
        ))}
      </div>
    </div>
  );
}

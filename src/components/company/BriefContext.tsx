"use client";

// BriefContext (PR-C1a): "02 Context" body row, multi-paragraph. Renders one
// <p> per element of memo.context.paragraphs with [n] markers parsed by
// CitedText.

import { CitedText } from "@/components/ui/cited-text";

interface BriefContextProps {
  paragraphs: string[];
  sourceCount: number;
  onCiteClick: (n: number) => void;
}

export function BriefContext({ paragraphs, sourceCount, onCiteClick }: BriefContextProps) {
  if (!paragraphs || paragraphs.length === 0) return null;
  return (
    <div data-testid="brief-context" className="flex gap-3 mb-3">
      <span className="font-data text-[9px] font-bold uppercase tracking-[0.10em] text-text-faint w-[60px] shrink-0 pt-1">
        02 · Context
      </span>
      <div className="flex-1 space-y-3">
        {paragraphs.map((text, i) => (
          <p
            key={i}
            data-testid="brief-context-paragraph"
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

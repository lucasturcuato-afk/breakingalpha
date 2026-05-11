"use client";

import { Cite } from "./cite";

interface CitedTextProps {
  children: string;
  onCiteClick?: (n: number) => void;
  sourceCount?: number;
  color?: string;
  className?: string;
  testId?: string;
  /**
   * When set, each rendered Cite gets `data-testid="${citeTestIdPrefix}-citation-${n}"`.
   * Used by the BriefTab to expose `brief-citation-{n}` selectors per spec.
   */
  citeTestIdPrefix?: string;
}

export function CitedText({ children, onCiteClick, sourceCount, color, className, testId, citeTestIdPrefix }: CitedTextProps) {
  const parts = String(children).split(/(\[\d+\])/g);
  return (
    <span className={className} data-testid={testId ?? "cited-text-line"}>
      {parts.map((p, i) => {
        const m = p.match(/^\[(\d+)\]$/);
        if (m) {
          const n = parseInt(m[1], 10);
          const exists = sourceCount == null ? true : n >= 1 && n <= sourceCount;
          const citeTestId = citeTestIdPrefix ? `${citeTestIdPrefix}-citation-${n}` : undefined;
          return <Cite key={i} n={n} onClick={onCiteClick} sourceExists={exists} color={color} testId={citeTestId} />;
        }
        return <span key={i}>{p}</span>;
      })}
    </span>
  );
}

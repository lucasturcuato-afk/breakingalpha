"use client";

import { Cite } from "./cite";

interface CitedTextProps {
  children: string;
  onCiteClick?: (n: number) => void;
  sourceCount?: number;
  color?: string;
  className?: string;
  testId?: string;
}

export function CitedText({ children, onCiteClick, sourceCount, color, className, testId }: CitedTextProps) {
  const parts = String(children).split(/(\[\d+\])/g);
  return (
    <span className={className} data-testid={testId ?? "cited-text-line"}>
      {parts.map((p, i) => {
        const m = p.match(/^\[(\d+)\]$/);
        if (m) {
          const n = parseInt(m[1], 10);
          const exists = sourceCount == null ? true : n >= 1 && n <= sourceCount;
          return <Cite key={i} n={n} onClick={onCiteClick} sourceExists={exists} color={color} />;
        }
        return <span key={i}>{p}</span>;
      })}
    </span>
  );
}

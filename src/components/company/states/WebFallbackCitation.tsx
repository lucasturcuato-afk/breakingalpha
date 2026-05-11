"use client";

/**
 * WebFallbackCitation (PR-E2): renders prose containing `[w1]`, `[w2]`, ...
 * markers from the web-grounded memo (type=company-web). Uses a dedicated
 * regex `/(\[w\d+\])/g` distinct from PR-A1's `[N]` form, so we do NOT
 * touch `cited-text.tsx`. Reuses the `Cite` primitive with `--purple` color
 * and emits `data-testid="web-fallback-citation-w<N>"` for each rendered
 * marker.
 *
 * Presentational only: clicks are wired to an optional `onCiteClick`
 * handler; the parent decides what (if anything) to do (jumping to a
 * source row in the source list is a follow-up wiring concern).
 */

import { Cite } from "@/components/ui/cite";

interface WebFallbackCitationProps {
  /** Memo prose containing `[w1]`, `[w2]`, ... markers. */
  children: string;
  /** Total number of source URLs; markers above this are rendered struck-through. */
  sourceCount?: number;
  /** Click handler receives the marker number (1-indexed). */
  onCiteClick?: (n: number) => void;
  className?: string;
}

const WEB_CITE_REGEX = /(\[w\d+\])/g;
const WEB_CITE_MATCH = /^\[w(\d+)\]$/;

export function WebFallbackCitation({ children, sourceCount, onCiteClick, className }: WebFallbackCitationProps) {
  const parts = String(children).split(WEB_CITE_REGEX);
  return (
    <span className={className} data-testid="web-fallback-cited-text">
      {parts.map((part, idx) => {
        const m = part.match(WEB_CITE_MATCH);
        if (m) {
          const n = parseInt(m[1], 10);
          const exists = sourceCount == null ? true : n >= 1 && n <= sourceCount;
          return (
            <Cite
              key={idx}
              n={n}
              onClick={onCiteClick}
              sourceExists={exists}
              color="var(--purple)"
              testId={`web-fallback-citation-w${n}`}
            />
          );
        }
        return <span key={idx}>{part}</span>;
      })}
    </span>
  );
}

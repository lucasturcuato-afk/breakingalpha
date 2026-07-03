"use client";

import { cn } from "@/lib/utils";
import { getCompleteness, getAdjustedScore, type Completeness } from "@/lib/article-signal-score";

// Re-exported so "@/lib/article-signal" stays the single public entry point.
// The scoring/completeness logic lives in the JSX-free sibling module so it can
// be unit-tested under node --test; see article-signal-score.ts.
export { getCompleteness, getAdjustedScore };
export type { Completeness };

export function CompletenessBadge({ completeness }: { completeness?: Completeness | null }) {
  if (!completeness) return null;

  const styles: Record<Completeness, { bg: string; label: string }> = {
    full: { bg: "bg-signal-up/10 text-signal-up", label: "Full text \u2713" },
    summary: { bg: "bg-parchment-mid text-text-secondary", label: "Summary" },
    // Light: solid bg-parchment-mid + text-muted (unchanged). Dark: the faint
    // white/10 fill reads as a near-invisible lift and text-muted is sub-AA on
    // it, so define the pill with a border (the same border-subtle token the
    // sibling Web badge uses on this surface) and lift the label to
    // text-primary, the next neutral up that clears 4.5:1. Kept neutral, not
    // gold, so it stays the visually-lesser badge vs the gold Summary.
    headline: { bg: "bg-parchment-mid dark:bg-white/10 text-text-muted dark:text-text-primary dark:border dark:border-border-subtle", label: "Headline only" },
  };

  const s = styles[completeness];
  return (
    <span className={cn("font-sans text-[9px] font-semibold px-1.5 py-0.5 rounded", s.bg)}>
      {s.label}
    </span>
  );
}

export function SignalScore({ score }: { score?: number | null }) {
  if (score == null) return null;
  return (
    <span className="font-sans text-[10px] text-text-muted font-semibold">
      Signal: {score.toFixed(1)}
    </span>
  );
}

// Minimum graded-outcome sample before a source's win rate is meaningful.
// Below this we hide the pill entirely — a 0% or 1-of-1 win rate on every
// story looks like broken data, not a signal.
const MIN_SAMPLE = 5;

export function SourceCredibilityBadge({
  winRate,
  sampleSize,
}: {
  winRate?: number | null;
  sampleSize?: number | null;
}) {
  if (winRate == null || winRate === 0) return null;
  if (sampleSize != null && sampleSize < MIN_SAMPLE) return null;
  return (
    <span className="font-sans text-[9px] text-text-secondary bg-parchment-mid px-1.5 py-0.5 rounded">
      Source: {Math.round(winRate)}% win rate
    </span>
  );
}

"use client";

import { cn } from "@/lib/utils";

export type Completeness = "full" | "summary" | "headline";

export function getCompleteness(
  content: string | null | undefined,
  summary?: string | null | undefined
): Completeness {
  if (content && content.length > 500) return "full";
  if (content && content.length >= 100) return "summary";
  if (summary && summary.length > 200) return "summary";
  return "headline";
}

export function getAdjustedScore(
  relevanceScore: number | null | undefined,
  completeness: Completeness
): number | null {
  if (relevanceScore == null) return null;
  const weights: Record<Completeness, number> = { full: 1.0, summary: 0.8, headline: 0.5 };
  return Math.round(relevanceScore * weights[completeness] * 10) / 10;
}

export function CompletenessBadge({ completeness }: { completeness?: Completeness | null }) {
  if (!completeness) return null;

  const styles: Record<Completeness, { bg: string; label: string }> = {
    full: { bg: "bg-signal-up/10 text-signal-up", label: "Full text \u2713" },
    summary: { bg: "bg-gold/10 text-gold-dark", label: "Summary" },
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
    <span className="font-data text-[10px] text-gold font-semibold tracking-tight">
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
    <span className="font-data text-[9px] text-gold-dark bg-gold/10 px-1.5 py-0.5 rounded">
      Source: {Math.round(winRate)}% win rate
    </span>
  );
}

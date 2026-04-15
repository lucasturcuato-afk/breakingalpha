"use client";

import { cn } from "@/lib/utils";

export type Completeness = "full" | "summary" | "headline";

export function getCompleteness(content: string | null | undefined): Completeness {
  if (!content) return "headline";
  const len = content.length;
  if (len > 500) return "full";
  if (len >= 100) return "summary";
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
    headline: { bg: "bg-parchment-mid text-text-muted", label: "Headline only" },
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
    <span className="font-data text-[11px] text-gold font-semibold">
      Signal: {score.toFixed(1)}
    </span>
  );
}

export function SourceCredibilityBadge({ winRate }: { winRate?: number | null }) {
  if (winRate == null) return null;
  return (
    <span className="font-data text-[9px] text-gold-dark bg-gold/10 px-1.5 py-0.5 rounded">
      Source: {Math.round(winRate)}% win rate
    </span>
  );
}

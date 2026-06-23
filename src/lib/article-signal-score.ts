// Pure (JSX-free) scoring + completeness helpers for article cards. Split out of
// article-signal.tsx so they can be unit-tested under `node --test` (the .tsx
// module carries JSX and cannot be type-stripped). article-signal.tsx re-exports
// these, so "@/lib/article-signal" stays the single public entry point and no
// call site changes.

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
  // Vestigial: kept so existing call sites stay unchanged after the decouple.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _completeness?: Completeness
): number | null {
  // Signal is the model's native relevance_score on its 0-10 scale. Completeness
  // no longer scales the score: the old completeness weighting collapsed the
  // relevance-saturated top tier to a flat 10 x 0.5 = 5.0 on every headline-only
  // card (every content-NULL gnews breaker rendered a uniform 5.0). Now that the
  // grader is de-saturated the score is earned and shown natively; completeness
  // is surfaced separately via CompletenessBadge. The second argument is retained
  // so existing call sites stay unchanged; it is intentionally unused now.
  if (relevanceScore == null) return null;
  return relevanceScore;
}

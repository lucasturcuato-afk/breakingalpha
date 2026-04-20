/**
 * personalization.ts — Core scoring engine for per-user content personalization.
 *
 * Every personalized surface imports from here. All scoring is 0.0 to 1.0,
 * higher = more relevant to this user. Works with the client-side UserProfile
 * from useUserProfile() hook (nullable fields).
 *
 * For server-side prompt injection, use buildPersonalizationContext() from
 * src/lib/user-profile.ts instead — it works with the full server-side profile.
 */

import type { UserProfile } from "@/hooks/useUserProfile";

// ─────────────────────────────────────────────────────────────────────────────
// Content scoring
// ─────────────────────────────────────────────────────────────────────────────

export interface ContentDescriptor {
  sectors?: string[];
  tickers?: string[];
  title?: string;
  categories?: string[];
}

/**
 * Score a piece of content against a user profile.
 * Returns 0.0 to 1.0, where 1.0 = perfectly relevant.
 *
 * Weight distribution:
 *   - Sector match:     40%
 *   - Watchlist match:  30%
 *   - Engagement proxy: 20%
 *   - Base:             10%
 */
export function scoreContentRelevance(
  content: ContentDescriptor,
  profile: UserProfile | null,
): number {
  if (!profile) return 0.5; // neutral when no profile

  let score = 0;

  const profileSectors = (profile.sectors ?? []).map((s) => s.toLowerCase());
  const watchlist = (profile.watchlist_tickers ?? []).map((t) => t.toUpperCase());

  // 1. Sector weight match (40%)
  if (profileSectors.length > 0) {
    const contentSectors = [
      ...(content.sectors ?? []),
      ...(content.categories ?? []),
    ].map((s) => s.toLowerCase());

    if (contentSectors.length > 0) {
      const matched = contentSectors.some((cs) =>
        profileSectors.some((ps) => cs.includes(ps) || ps.includes(cs)),
      );
      score += matched ? 0.4 : 0;
    }
  }

  // 2. Watchlist ticker match (30%)
  if (watchlist.length > 0) {
    const allTickers = (content.tickers ?? []).map((t) => t.toUpperCase());
    const titleUpper = (content.title ?? "").toUpperCase();

    const directMatch = allTickers.some((t) => watchlist.includes(t));
    const titleMatch = !directMatch && watchlist.some((t) => titleUpper.includes(t));

    if (directMatch) {
      score += 0.3;
    } else if (titleMatch) {
      score += 0.15;
    }
  }

  // 3. Engagement proxy — sector in top 3 gets a bonus (20%)
  const topSectors = getTopSectors(profile, 3);
  if (topSectors.length > 0) {
    const contentSectors = [
      ...(content.sectors ?? []),
      ...(content.categories ?? []),
    ].map((s) => s.toLowerCase());

    const inTop = contentSectors.some((cs) =>
      topSectors.some((ts) => cs.includes(ts) || ts.includes(cs)),
    );
    score += inTop ? 0.2 : 0;
  }

  // 4. Base relevance (10%) — always present
  score += 0.1;

  return Math.min(1.0, Number(score.toFixed(4)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Sorting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sort items by relevance to user profile, highest first.
 * extractContent maps each item to a ContentDescriptor for scoring.
 */
export function sortByRelevance<T>(
  items: T[],
  profile: UserProfile | null,
  extractContent: (item: T) => ContentDescriptor,
): T[] {
  if (!profile) return items;

  return [...items].sort((a, b) => {
    const scoreA = scoreContentRelevance(extractContent(a), profile);
    const scoreB = scoreContentRelevance(extractContent(b), profile);
    return scoreB - scoreA;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Watchlist helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a ticker is on the user's watchlist.
 */
export function isOnWatchlist(
  ticker: string | null | undefined,
  profile: UserProfile | null,
): boolean {
  if (!ticker || !profile?.watchlist_tickers) return false;
  return profile.watchlist_tickers
    .map((t) => t.toUpperCase())
    .includes(ticker.toUpperCase());
}

// ─────────────────────────────────────────────────────────────────────────────
// Sector helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the user's top N sectors. Prefers explicit sectors list;
 * doesn't use inferred_sector_weights since those aren't available
 * on the client-side UserProfile type.
 */
export function getTopSectors(
  profile: UserProfile | null,
  n: number = 3,
): string[] {
  if (!profile?.sectors) return [];
  return profile.sectors.slice(0, n).map((s) => s.toLowerCase());
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt context builder (client-side version)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a natural language profile summary for injection into Gemini prompts.
 * This is the client-side version — for server-side use buildPersonalizationContext
 * from src/lib/user-profile.ts which has access to inferred weights.
 */
export function profileToPromptContext(profile: UserProfile | null): string {
  if (!profile) return "";
  const parts: string[] = [];

  if (profile.role) parts.push(`The user is a ${profile.role}.`);
  if (profile.strategy_type) parts.push(`Their investment strategy is ${profile.strategy_type}.`);

  const sectors = profile.sectors ?? [];
  if (sectors.length > 0) parts.push(`Their priority sectors are: ${sectors.join(", ")}.`);

  const tickers = profile.watchlist_tickers ?? [];
  if (tickers.length > 0) parts.push(`They are actively watching: ${tickers.join(", ")}.`);

  if (profile.risk_appetite) parts.push(`Their risk tolerance is ${profile.risk_appetite}.`);
  if (profile.investment_horizon) parts.push(`Their investment horizon is ${profile.investment_horizon}.`);

  return parts.join(" ");
}

/**
 * Check if a sector matches the user's profile (fuzzy, case-insensitive).
 */
export function sectorMatchesProfile(
  sector: string | null | undefined,
  profile: UserProfile | null,
): boolean {
  if (!sector || !profile?.sectors?.length) return false;
  const lower = sector.toLowerCase();
  return profile.sectors.some((ps) => {
    const pl = ps.toLowerCase();
    return lower.includes(pl) || pl.includes(lower);
  });
}

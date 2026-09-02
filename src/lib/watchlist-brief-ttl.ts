/**
 * How long a cached `watchlist_briefs` row may be served before it is treated
 * as stale.
 *
 * This was a bare `12 * 60 * 60 * 1000` living only in
 * src/app/watchlist/[identifier]/page.tsx. The export route selected
 * `generated_at` and then ignored it, so the same brief the watchlist page
 * refused to render as stale was still handed out by
 * /api/export/company-pdf. Hoisted here so both read paths share one number
 * and cannot drift apart again.
 */
export const WATCHLIST_BRIEF_TTL_MS = 12 * 60 * 60 * 1000;

/** True when a brief generated at `generatedAt` is still inside the TTL. */
export function isBriefFresh(
  generatedAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!generatedAt) return false;
  const t = new Date(generatedAt).getTime();
  if (Number.isNaN(t)) return false;
  return now - t < WATCHLIST_BRIEF_TTL_MS;
}

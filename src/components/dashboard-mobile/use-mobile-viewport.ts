"use client";

/**
 * Two things the mobile Dashboard needs that must cost a desktop load nothing.
 *
 * The mobile screen is composed beside the desktop layout rather than
 * replacing it, so above the `md` breakpoint its whole subtree is mounted and
 * merely `display:none`. Any timer or interval it sets up there is work done
 * for a tree nobody can see, and a state update in it re-renders the desktop
 * page. So both hooks below ask `matchMedia` first and set no timer above the
 * breakpoint.
 *
 * The query is Tailwind's `md` minus a pixel, which is exactly where
 * `md:hidden` stops applying, and is the same string `use-mobile-records.ts`
 * uses for the same reason.
 */

import { useEffect, useState } from "react";

export const MOBILE_MEDIA_QUERY = "(max-width: 767px)";

function isMobileViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

const MINUTE_MS = 60_000;

/**
 * The current minute, as an epoch stamp, re-read once a minute below `md`.
 *
 * The screen's clock was read once, when the data first resolved, and then
 * never again, so a phone left open on the briefing showed a time under a rule
 * that reads as live and was not. Truncated to the minute so the value is
 * stable between ticks and the memo that consumes it is not invalidated on
 * every render.
 *
 * Seeded from the clock rather than from null, and that cannot mismatch on
 * hydration: the screen paints its skeleton on both sides of it, because the
 * page-level reads this value feeds are still outstanding at first paint.
 */
export function useMobileMinute(): number {
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / MINUTE_MS));

  useEffect(() => {
    if (!isMobileViewport()) return;
    /* Align to the next minute boundary, then tick on it, so the displayed
       time changes when the clock does rather than a random offset later. */
    let interval: ReturnType<typeof setInterval> | undefined;
    const align = setTimeout(
      () => {
        setMinute(Math.floor(Date.now() / MINUTE_MS));
        interval = setInterval(() => setMinute(Math.floor(Date.now() / MINUTE_MS)), MINUTE_MS);
      },
      MINUTE_MS - (Date.now() % MINUTE_MS),
    );
    return () => {
      clearTimeout(align);
      if (interval) clearInterval(interval);
    };
  }, []);

  return minute;
}

/**
 * True once `arrived` goes true, or once the budget elapses below `md`,
 * whichever is first. Never goes back to false.
 *
 * WHY A BUDGET AT ALL. The screen keeps its skeleton while a read is in
 * flight, which is honest and is the whole point of it. But a read that never
 * answers would keep the skeleton up forever, and a permanent skeleton tells the
 * reader something is coming when nothing is. The budget is the escape: past
 * it the screen paints, and every field whose read is still outstanding is
 * passed to the loader as null, so it is drawn as an absence rather than as a
 * zero. Absent is what "we do not know" looks like; zero is a claim.
 *
 * Above `md` no timer is set and `elapsed` never flips, so the value is just
 * `arrived`. The desktop pays neither a timer nor the re-render that firing
 * one would cost, and the tree it would have revealed is `display:none`
 * anyway.
 */
export function useArrivalBudget(arrived: boolean, budgetMs: number): boolean {
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    if (arrived || elapsed) return;
    if (!isMobileViewport()) return;
    const timer = setTimeout(() => setElapsed(true), budgetMs);
    return () => clearTimeout(timer);
  }, [arrived, elapsed, budgetMs]);

  return arrived || elapsed;
}

"use client";

/**
 * The breakpoint, and the two clocks the mobile Dashboard needs that must cost
 * a desktop load nothing.
 *
 * `md:hidden` and `hidden md:block` decide what is VISIBLE. They do not decide
 * what is MOUNTED: `display:none` still mounts, still runs effects and still
 * fetches. Every timer, interval and round-trip a subtree starts on the wrong
 * side of the breakpoint is work done for a tree nobody can see, and a state
 * update in it re-renders the page. So the two clocks below ask `matchMedia`
 * first and set no timer above the breakpoint, and the two hooks below them
 * decide the MOUNT for callers that need the stronger guarantee.
 *
 * The queries are Tailwind's `md` and `md` minus a pixel, which is exactly
 * where `md:hidden` and `hidden md:block` change hands.
 */

import { useEffect, useState, useSyncExternalStore } from "react";

export const MOBILE_MEDIA_QUERY = "(max-width: 767px)";
export const DESKTOP_MEDIA_QUERY = "(min-width: 768px)";

function isMobileViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

/**
 * The breakpoint as an external store, in the shape `use-mobile-records.ts`
 * already proved out: `useSyncExternalStore` rather than an effect and a
 * `setState`, so the FIRST client render already carries the real viewport
 * instead of one render later, and so React is handed the server snapshot
 * explicitly.
 */
function subscriber(query: string) {
  return function subscribe(onChange: () => void): () => void {
    if (typeof window === "undefined") return () => {};
    const mql = window.matchMedia(query);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  };
}

const subscribeMobile = subscriber(MOBILE_MEDIA_QUERY);
const subscribeDesktop = subscriber(DESKTOP_MEDIA_QUERY);

function mobileSnapshot(): boolean {
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

function desktopSnapshot(): boolean {
  return window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
}

/**
 * BOTH SERVER SNAPSHOTS ARE FALSE, AND THAT IS THE WHOLE MECHANISM.
 *
 * There is no viewport on the server. React renders the server snapshot on the
 * server AND again for the hydration render on the client, then re-renders
 * with the real one. So false means "not this side of the breakpoint, do not
 * mount", on both passes, for both hooks, and there is no markup for hydration
 * to disagree about.
 *
 * It has to be false for the DESKTOP hook specifically. React runs child
 * effects before parent effects, so anything present in the hydration render
 * has already fired its fetches by the time a store re-render could unmount
 * it. A subtree that must not fetch on a phone must therefore be absent from
 * the hydration render, which means absent from the server render too.
 */
function absentOnServer(): boolean {
  return false;
}

/** True below `md`, where `md:hidden` still applies. False until hydration. */
export function useMobileViewport(): boolean {
  return useSyncExternalStore(subscribeMobile, mobileSnapshot, absentOnServer);
}

/** True at `md` and above, where `hidden md:block` applies. False until hydration. */
export function useDesktopViewport(): boolean {
  return useSyncExternalStore(subscribeDesktop, desktopSnapshot, absentOnServer);
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

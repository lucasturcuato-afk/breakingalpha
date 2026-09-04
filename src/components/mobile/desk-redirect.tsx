"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import styles from "./desk-redirect.module.css";

/**
 * Six desk screens, sent to their mobile twins below `md`.
 *
 * ONE COMPONENT, MOUNTED ONCE, AND NO PAGE FILE TOUCHED. The obvious shape is a
 * width guard at the top of each of the six pages. That is six edits to six
 * files, it scatters the mapping across the tree so no reader can see the table,
 * and two of those six files cannot be edited at all: `/trends` is propose-only
 * and `/radar/watchlist` is being changed in parallel. Mounting one client
 * component in the root layout reaches all six routes without opening any of
 * them, and puts the whole mapping on one screen where a wrong target is
 * visible.
 *
 * THE TWO `/watch` TARGETS ARE THE EASY ONES TO GET WRONG, and an earlier survey
 * did. Before PR #790, mobile Radar was one route, `/watch`, carrying a
 * watchlist tier and a following tier in a single scroll. #790 split it into
 * four sections, and `/watch` KEPT THE BARE PATH FOR FOLLOWING:
 * `src/app/watch/page.tsx` renders `segment="following"`, and the watchlist
 * moved to `src/app/watch/watchlist/page.tsx` with `segment="watchlist"`. Both
 * were read on this branch before the table below was written. Sending
 * `/radar/watchlist` to `/watch` would land a reader who asked for their
 * watchlist on Following, which is a wrong screen rather than a missing one and
 * would not look like a bug.
 *
 * EXACT PATHS ONLY, WHICH IS WHAT KEEPS `/company/[id]` ALIVE. The lookup is a
 * plain key match, never a prefix test. `/company` is the directory and it has
 * a twin at `/ask`; `/company/AAPL` is a company screen with its own mobile
 * treatment in `src/components/company/mobile/` and must not be redirected. A
 * prefix match would have taken every company page with it.
 *
 * DESKTOP IS UNTOUCHED BY CONSTRUCTION. Above `md` the media query in the
 * stylesheet does not apply, so the cover paints nothing and `#main-content` is
 * never hidden; the effect below asks `matchMedia` before it navigates, so no
 * navigation happens either. The component still renders one empty div on the
 * six routes, which is why it carries `aria-hidden`.
 */

/**
 * The `md` breakpoint, as a media query.
 *
 * PAIRED WITH `desk-redirect.module.css`, which repeats this width, and the two
 * must not drift. A width where the stylesheet hides the desk screen but this
 * module declines to navigate is a blank page with no way off it. It is written
 * twice because a CSS module cannot read a TypeScript constant and this is the
 * boundary; the comment in each file names the other.
 */
const PHONE_WIDTH = "(max-width: 767.98px)";

/**
 * Desk route to mobile twin.
 *
 * Every value was opened and read on this branch before it was written here.
 * Keys are matched exactly, so nothing below a listed path is caught.
 */
const DESK_TO_TWIN: Readonly<Record<string, string>> = {
  "/morning-brief": "/ledger",
  "/trends": "/trends-mobile",
  "/radar/desk-record": "/desk-record",
  "/radar/watchlist": "/watch/watchlist",
  "/radar/following": "/watch",
  "/company": "/ask",
};

export function DeskRedirect() {
  const pathname = usePathname();
  const router = useRouter();

  const twin = pathname ? (DESK_TO_TWIN[pathname] ?? null) : null;

  useEffect(() => {
    if (twin === null) return;

    const mq = window.matchMedia(PHONE_WIDTH);

    /* `replace`, never `push`. A desk route that redirects is not a place a
       reader can stand, so leaving it in the history stack means the browser's
       own back control lands on it and is immediately sent forward again: the
       reader presses back and nothing moves. Replacing takes the desk route out
       of the stack, so back reaches whatever they were actually on. */
    const settle = () => {
      if (mq.matches) router.replace(twin);
    };

    settle();

    /* A window dragged narrower crosses the same line. The stylesheet is keyed
       on width alone, so once it applies the desk content is out of layout
       whether or not this module reacted; without this listener that reader is
       left on a covered screen. Reacting keeps the two halves saying the same
       thing at every width. */
    mq.addEventListener("change", settle);
    return () => mq.removeEventListener("change", settle);
  }, [twin, router]);

  if (twin === null) return null;

  /* The attribute is the stylesheet's hook and it carries the destination, so
     the DOM says where this screen is going rather than only that it is going.
     A capture taken mid-navigation can be read without the source. */
  return <div className={styles.cover} data-desk-redirect={twin} aria-hidden="true" />;
}

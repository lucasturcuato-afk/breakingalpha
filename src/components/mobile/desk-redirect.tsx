"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { PHONE_WIDTH, resolveTwinPath } from "./desk-redirect-map";
import styles from "./desk-redirect.module.css";

/**
 * Five desk screens, sent to their mobile twins below `md`.
 *
 * ONE COMPONENT, MOUNTED ONCE, AND NO PAGE FILE TOUCHED. The obvious shape is a
 * width guard at the top of each page. That is one edit per route, it scatters
 * the mapping across the tree so no reader can see the table, and two of those
 * files cannot be edited at all: `/trends` is propose-only and
 * `/radar/watchlist` is being changed in parallel. Mounting one client component
 * in the root layout reaches every route without opening any of them.
 *
 * THE TABLE AND ITS RULES LIVE IN `desk-redirect-map.ts`, which imports nothing
 * and is unit tested. Two things are settled there rather than here, and both
 * are decisions rather than defaults: which routes redirect, including why
 * `/radar/following` is exempt, and what happens to the query string. If you
 * are adding a route, read that file first.
 *
 * IT WAS SIX. `/radar/following` is exempt on the owner's ruling of 2026-09-03,
 * because it is the only surface in the app that writes a follow and it was the
 * least damaged route in the bucket. The reasoning is recorded beside the map.
 *
 * DESKTOP IS UNTOUCHED BY CONSTRUCTION. Above `md` the media query in the
 * stylesheet does not apply, so the cover paints nothing and `#main-content` is
 * never hidden; the effect below asks `matchMedia` before it navigates, so no
 * navigation happens either. The component still renders one empty div on the
 * five listed routes, which is why it carries `aria-hidden`.
 */

export function DeskRedirect() {
  const pathname = usePathname();
  const twin = resolveTwinPath(pathname);

  useEffect(() => {
    if (twin === null) return;

    const mq = window.matchMedia(PHONE_WIDTH);

    /*
     * `location.replace`, NOT `router.replace`, AND THIS IS A MEASURED FIX
     * RATHER THAN A PREFERENCE.
     *
     * `router.replace` navigates without tearing down the document, so whatever
     * held focus keeps holding it. On arrival nothing in this app has been
     * clicked yet, so focus is still on the root skip link in `app-shell.tsx`,
     * and Chrome's focus-visible heuristic treats a programmatic navigation as
     * a non-pointer interaction. The skip link is `sr-only` until
     * `:focus-visible` matches and `absolute top-2 left-2 z-50` once it does.
     * So it inflates from 1x1 to 145x31 at the top left of the DESTINATION and
     * paints over whatever is under it.
     *
     * Measured on this branch, arriving through the redirect at 320 and 390 in
     * both themes: the box is 145x31 with `:focus-visible` true on all five
     * destinations, against 1x1 and false on a cold load of the same screens.
     * It covers the centre point of a real control on three of the five, which
     * are exactly the three that draw a back or segment control in the top left
     * corner; `/ledger` and `/ask` put their first control lower and to the
     * right and are visually affected but not occluded. `elementFromPoint` at
     * those covered centres answers the skip anchor, not the control.
     *
     * `location.replace` loads a fresh document, so focus starts at the body
     * and the skip link is back to 1x1. It costs the client-side transition,
     * which is a fair price here: the cover is already hiding the desk screen
     * for the whole navigation, so the reader sees no difference, and the
     * destination arrives server rendered rather than reconciled.
     *
     * The history entry is replaced either way, so back still skips the desk
     * route rather than landing on one that immediately sends the reader
     * forward again.
     */
    const settle = () => {
      if (mq.matches) window.location.replace(twin);
    };

    settle();

    /* A window dragged narrower crosses the same line. The stylesheet is keyed
       on width alone, so once it applies the desk content is out of layout
       whether or not this module reacted; without this listener that reader is
       left on a covered screen. */
    mq.addEventListener("change", settle);
    return () => mq.removeEventListener("change", settle);
  }, [twin]);

  if (twin === null) return null;

  /* The attribute is the stylesheet's hook and it carries the destination, so
     the DOM says where this screen is going rather than only that it is going.
     A capture taken mid-navigation can be read without the source. */
  return <div className={styles.cover} data-desk-redirect={twin} aria-hidden="true" />;
}

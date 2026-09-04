"use client";

import { useEffect } from "react";
import { callsDeskDestination } from "@/lib/calls-desk-destination";
import styles from "./calls-desk-redirect.module.css";

/**
 * /radar/calls, on a phone, goes to the screen built for it.
 *
 * WHY THIS IS NOT THE SHARED DESK REDIRECT. The batch that redirects five desk
 * routes maps a bare pathname to a bare path literal, and it deliberately left
 * this route out. Its own note, in `src/components/search/search-data.ts`,
 * gives the reason: the hrefs into this screen carry `?views=open`, and the
 * twin took no searchParams, so the swap would silently drop the filter. That
 * reasoning was right and this unit did not overturn it, it satisfied it.
 * `src/lib/calls-desk-destination.ts` maps all four of this route's params onto
 * the phone screen that already owns each intent, and the twin was taught to
 * receive the two it could. Nothing is dropped, so the redirect is now safe.
 *
 * WHY IT MOUNTS FROM A ROUTE SEGMENT AND NOT THE ROOT LAYOUT. Two reasons, and
 * the second is the one that settles it. It is scoped: this component exists on
 * exactly one route and cannot affect another by a typo in a table. And
 * `src/app/radar/calls/page.tsx` is not edited by this, which its own twin's
 * header requires in as many words. A sibling `layout.tsx` is the App Router's
 * answer to "this route and only this route" and touches no existing file.
 *
 * WITH JAVASCRIPT OFF THIS FAILS OPEN, NOT CLOSED, and that is a deliberate
 * divergence from the shared mechanism. There, the CSS half applies on width
 * alone while the navigation lives in an effect, so a reader with no JS gets a
 * blank token-coloured screen and no way off it. Here the layout ships a
 * `<noscript>` that puts `#main-content` back and takes the cover away, so the
 * same reader gets the desk screen. It overflows. An overflowing screen a
 * reader can use beats a blank one they cannot, and the trade only exists for
 * the reader who cannot be navigated anyway.
 *
 * `replace`, never `push`. A route that redirects is not a place a reader can
 * stand, so leaving it in the history stack means their own back control lands
 * on it and is sent forward again: they press back and nothing moves.
 *
 * A DOCUMENT NAVIGATION, NOT `router.replace`, AND THIS ONE WAS MEASURED.
 * `router.replace` was written first and it put a focused, PAINTED skip link
 * over the destination's navigation. The chain is: every client-side navigation
 * in this app leaves focus on the root layout's "Skip to main content" anchor,
 * which is `sr-only` until `:focus-visible`; a tap-driven navigation does not
 * match `:focus-visible` and the anchor stays a 1px box, but a programmatic one
 * does, so it painted at 145 by 31 at (8, 8). At 390 that box covers the centre
 * of the first two of Radar's four section links, and `elementFromPoint` at
 * both of those centres answered the anchor, not the link. A reader arriving
 * from the Morning Brief would have spent their first tap on a control they did
 * not choose. Measured at 320, 375, 390 and 430, in both themes, and again on a
 * cold load and a tapped navigation as controls: only the programmatic path
 * paints it.
 *
 * `location.replace` gives a cold document, and a cold document starts with
 * focus on the body and the anchor back at 1px. It also replaces the history
 * entry exactly as `router.replace` does, so the back behaviour above is
 * unchanged. What it costs is one document load, and it is spent abandoning a
 * client bundle and two data reads this reader is never going to see.
 */

/** Must equal the `@media` width in the sibling stylesheet. See its header. */
const PHONE_WIDTH = "(max-width: 767.98px)";

export function CallsDeskRedirect() {
  useEffect(() => {
    const mq = window.matchMedia(PHONE_WIDTH);

    /* Read at navigation time, not at mount. The four params are on
       `window.location`, which is the same place `/radar/calls` reads them from
       (`page.tsx:145`), so the two surfaces cannot disagree about what arrived.
       `useSearchParams` would work and would opt this segment out of static
       prerendering, which would take the server-rendered cover with it. */
    const settle = () => {
      if (!mq.matches) return;
      const to = callsDeskDestination(window.location.search);
      /* Guard against a re-entry that would replace the entry we just replaced.
         `location.replace` does not resolve synchronously, and the media query
         listener below can fire while it is in flight. */
      if (window.location.pathname !== "/radar/calls") return;
      window.location.replace(to);
    };

    settle();

    /* A window dragged narrower crosses the same line. The stylesheet is keyed
       on width alone, so once it applies the desk content is out of layout
       whether or not this module reacted. Reacting keeps the two halves saying
       the same thing at every width. */
    mq.addEventListener("change", settle);
    return () => mq.removeEventListener("change", settle);
  }, []);

  /* The attribute is the stylesheet's hook, and it is also what a capture taken
     mid-navigation can be read by: the DOM says this screen is on its way out
     without the reader of that capture needing the source. */
  return <div className={styles.cover} data-calls-desk-redirect="" aria-hidden="true" />;
}

export default CallsDeskRedirect;

"use client";

/**
 * Is the viewport below `md`, measured rather than assumed.
 *
 * WHY THIS EXISTS. The mobile Evening Wrap is composed BESIDE the desk layout
 * rather than replacing it, and the gate between them is a CSS class. So at
 * 1440 the mobile subtree still mounts, still hydrates and still runs every
 * effect inside it; it is merely `display:none`. Three requests were firing on
 * every desktop load for a tree nobody can see: the session's open-calls
 * select, the story rail's quote fetch, and the ticker strip's own quote poll,
 * which repeats every 60 seconds for as long as the tab is open.
 *
 * PR #675 solved the same problem the same way in
 * `src/components/dashboard-mobile/use-mobile-records.ts` and measured zero
 * extra desktop requests. This is that approach, as a hook, because this
 * screen has to gate a rendered child as well as two effects.
 *
 * The query is Tailwind's `md` minus a pixel, which is exactly where
 * `md:hidden` stops applying, so the reads happen at precisely the widths the
 * screen is visible at and nowhere else.
 *
 * IT ANSWERS FALSE ON THE SERVER AND ON THE FIRST CLIENT RENDER. That is
 * deliberate and it is the safe direction: the mount is never gated on it, so
 * a phone still gets the screen and its loading state in the server HTML, and
 * the only thing that waits a tick is work that was not going to be visible
 * for a round trip anyway.
 */

import { useEffect, useState } from "react";

/** Below `md`, where `md:hidden` still applies. */
export const MOBILE_VIEWPORT_QUERY = "(max-width: 767px)";

export function useIsMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(MOBILE_VIEWPORT_QUERY);
    const sync = () => setIsMobile(mq.matches);
    sync();
    /* Resizing across the breakpoint has to move it in both directions, or a
       desktop window narrowed to a phone width would sit on a screen whose
       reads never ran. */
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return isMobile;
}

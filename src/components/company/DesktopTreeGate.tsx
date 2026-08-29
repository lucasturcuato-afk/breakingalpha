"use client";

/**
 * The mount gate for `/company/[id]`'s DESKTOP tree.
 *
 * WHAT IT FIXES. The route composes both trees into one document and lets a
 * CSS class pick which one is visible: `md:hidden` on the mobile screen and
 * `hidden md:block` on the desk. Both are `display:none`, which removes a
 * subtree from the accessibility tree and from layout and removes NOTHING
 * else. The component still mounts, still hydrates, and still runs every
 * effect inside it.
 *
 * Measured at 390px, signed in, zero interaction, before this gate existed:
 * a phone load fired `POST /api/company-overview`, which reaches
 * gemini-2.5-flash on a cache miss, plus `GET /api/company-kpis`,
 * `/api/company-trend`, `/api/stock-chart`, `/api/memo-cache` and
 * `/api/watchlist`. Six round trips for a tree the reader cannot see, two of
 * them leaving our infrastructure and one of them reaching a model. The same
 * mount is why `/api/company-kpis`, `/api/company-trend` and `/api/stock-chart`
 * were still in flight past 30 seconds on a phone: they are the desk's fetches,
 * not the screen's.
 *
 * WHY A MOUNT GATE AND NOT SIX EFFECT GUARDS. A guard inside each fetching
 * component closes the six requests that exist today and nothing else: the
 * next component added to a tab, or the next fetch added to one of these, is
 * back on a phone's bill with nobody to catch it. The mount is the one place
 * the breakpoint can be stated once.
 *
 * THE CLASS STAYS ON THE WRAPPER. `hidden md:block` still decides VISIBILITY,
 * in a class and never in an inline style, because an inline display beats the
 * class at every breakpoint. This gate decides the MOUNT, which is a different
 * question, and the two agree on the same pixel: `useDesktopViewport` reads
 * `(min-width: 768px)`, which is exactly where `hidden md:block` takes over.
 *
 * NO HYDRATION MISMATCH, and that is the whole reason it is written against
 * `useDesktopViewport` rather than an effect. Its server snapshot is `false`
 * on the server AND on the hydration render, so both passes emit the same
 * empty wrapper and there is no markup for hydration to disagree about. React
 * runs child effects before parent effects, so a subtree that must not fetch on
 * a phone has to be absent from the hydration render, which means absent from
 * the server render too. `dashboard-mobile/mobile-reveal-gate.tsx` is the same
 * mechanism in the other direction.
 *
 * WHAT IT COSTS AT `md` AND ABOVE. The desk markup is no longer in the server
 * HTML; it mounts on the first render after hydration. Nothing is re-fetched to
 * get it: every element is already in the RSC payload, so the cost is the
 * hydration tick and not a round trip. This route is behind the auth redirect
 * in `src/proxy.ts`, so no crawler ever saw that HTML either.
 */

import type { ReactNode } from "react";

import { useDesktopViewport } from "@/components/dashboard-mobile/use-mobile-viewport";

export function DesktopTreeGate({ children }: { children: ReactNode }) {
  const isDesktop = useDesktopViewport();

  /* The wrapper is emitted either way so the shell's own layout sees the same
     child list at every width, and the class on it is unchanged. */
  return <div className="hidden md:block">{isDesktop ? children : null}</div>;
}

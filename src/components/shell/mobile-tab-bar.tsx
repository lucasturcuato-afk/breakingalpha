"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { FONT_SANS } from "@/components/mobile/fonts";

/**
 * Mobile tab bar. Four poles, replacing the six-slot bar in mobile-bottom-nav.
 *
 * Every value here was measured off the rendered design with getComputedStyle
 * (design_handoff_signalera_mobile/Signalera Mobile v3.dc.html, the nav element):
 * 58px rows, 5px icon-to-label gap, 20x20 icons at stroke-width 1.7, labels at
 * 10.5px Inter, weight 500 inactive and 600 active, a 1px top rule on
 * --c-border, and the bar filled with --c-bg. Active rows carry --c-ink type
 * with a --c-gold icon; inactive rows are --c-muted throughout.
 *
 * The design measures a 0s transition on the row, so nothing here animates and
 * there is nothing for prefers-reduced-motion to disable. Focus rings come from
 * the global focus-visible rule, which already matches the design at 2px gold,
 * 2px offset, 4px radius.
 */

type Pole = {
  label: string;
  href: string;
  icon: (stroke: string) => ReactNode;
  /** Routes that light this pole. Matched exactly or as a path prefix. */
  owns: string[];
};

/**
 * Icons are reproduced from the design at 20x20 on a 24-unit viewBox.
 *
 * Stroke is passed rather than inherited through `color`. On the active row the
 * design paints the icon --c-gold, which is a fill token and may not carry
 * type; setting it as a stroke keeps the design's pixels while leaving the row's
 * `color` to the ink token that actually renders the label.
 */

const IconToday = (stroke: string) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
    <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" />
    <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" />
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" />
    <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" />
  </svg>
);

const IconLedger = (stroke: string) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
    <path d="M4 4v16M8 6h12M8 11h12M8 16h8" />
  </svg>
);

const IconWatch = (stroke: string) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.7" aria-hidden="true">
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="2.4" />
  </svg>
);

const IconAsk = (stroke: string) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-4-4" />
  </svg>
);

/**
 * The four poles, in the design's order.
 *
 * `owns` lists only routes whose pole is settled by the handoff's navigation
 * model. Routes whose pole is still an open question (/radar bare,
 * /radar/track-record, /radar/desk-record, /radar/theses) are deliberately
 * absent, so they light no pole rather than being assigned by guesswork.
 */
const POLES: Pole[] = [
  {
    label: "Today",
    href: "/dashboard",
    icon: IconToday,
    owns: ["/dashboard"],
  },
  {
    /* The pole's destination is the Ledger itself as of PR 622. It pointed at
       /morning-brief while that screen did not exist. The brief and the wrap
       stay in `owns` because the pole still owns them: reaching a brief from
       elsewhere must light Ledger, not nothing. `owns` carries /ledger
       explicitly since isActive reads `owns` alone and never `href`, so a pole
       whose destination is missing from its own list goes dark on arrival. */
    label: "Ledger",
    href: "/ledger",
    icon: IconLedger,
    owns: [
      "/ledger",
      "/morning-brief",
      "/evening-wrap",
      "/radar/calls",
      /* Steps 4, 6 and 7. Objects opened out of the record, so they belong to
         the pole the record lives on. Listed before the screens exist because
         isActive reads `owns` alone: a route absent from every list lights no
         pole, and adding it later would mean a screen unit editing this file. */
      "/review",
      "/claim",
      "/entry",
      "/record",
      "/compose",
    ],
  },
  {
    /* THE HREF HAS MOVED TO /watch, and the condition it was waiting on is
       satisfied. The rule this comment carried was: move it when /watch READS
       A LOADER, not when /watch merely answers. PR #653 moved it against a
       screen with no read behind it and was closed for it; the href sat back
       on /radar/watchlist until now.

       WHAT MADE IT TRUE. `src/lib/watch-data.ts` reads the reader's own
       watchlist rows, the articles behind each entry, and their follows, and
       `/watch` renders that. A phone reader tapping this pole now lands on a
       screen with their data on it. The unwired notice is gone from the
       screen entirely.

       WHAT SHIPPED AND WHAT DID NOT, because a reader of this file in six
       months must not have to guess:

         watchlist  SHIPS. Rows scoped by user, articles per entry, quiet
                    names, and a per-entry read that faulted named as an
                    omission rather than counted quiet.
         following  SHIPS. `matchFollow` called directly. Coverage, quiet and
                    MUTED are three separate counts; the desktop folds muted
                    into quiet and that conflation was not ported. Theme
                    headings are omitted: cluster labels are null until a lazy
                    model pass writes them.
         hero       OMITTED. The design promotes one entity to pinned espresso
                    carrying "today's strongest story". No column ranks a
                    reader's names, and a winner derived from `published_at`
                    is a timestamp dressed up as a judgement.
         tracked
         views      OMITTED, and this is the one that would restore a whole
                    tier. `TrackedView` needs the headline a note was written
                    against. `user_claims` has no article foreign key, no
                    article_id and no title column, so that headline has no
                    source at all. Rendering a note without its story strips
                    the tier of its meaning, and inventing a plausible headline
                    beside a real note is the `/ledger` invented-brief defect
                    (see #670) with a different table under it.

       WHAT WOULD HAVE TO BE TRUE TO RESTORE TIER 1: either an article foreign
       key on `user_claims` plus a backfill of what can be recovered, or an
       amendment to the `TrackedView` contract dropping `headline` and
       redrawing the tier around note and date alone. Both need a migration and
       an owner. Neither is written. Until one lands the tier stays absent
       rather than approximated, and this pole points at a two-tier screen.

       The consequence the old comment recorded is now gone: standing ON /watch
       the pole is lit AND its href is the route the reader is on, so tapping a
       lit pole is the no-op it should always have been.

       /radar/watchlist and /radar/following stay in `owns` and stay reachable.
       They are not deleted, they are not edited by this change, and the empty
       states on /watch link to them by name because /watch has no add
       affordance. */
    label: "Watch",
    href: "/watch",
    icon: IconWatch,
    owns: ["/radar/watchlist", "/radar/following", "/watch"],
  },
  {
    label: "Ask",
    href: "/intelligence",
    icon: IconAsk,
    owns: [
      "/intelligence",
      "/company",
      "/deal-flow",
      "/trends",
      "/live-feed",
      /* Step 9 and 10. /trends-mobile is the mobile Trends screen, which lands
         beside /trends rather than editing it. Without this entry it would
         light no pole, since the Ask pole owns /trends and not its sibling. */
      "/ask",
      "/search",
      "/trends-mobile",
      "/signal",
      "/story",
    ],
  },
];

function isActive(pole: Pole, pathname: string): boolean {
  return pole.owns.some(
    (route) => pathname === route || pathname.startsWith(route + "/"),
  );
}

export function MobileTabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      /* Layout stays in classes, never in the style attribute: an inline
         `display` beats `md:hidden` and the bar renders at every width. */
      className="flex items-stretch md:hidden fixed bottom-0 left-0 right-0 z-40"
      style={{
        borderTop: "1px solid var(--c-border)",
        backgroundColor: "var(--c-bg)",
        /* The bar sits above the band Safari owns rather than behind it. */
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {POLES.map((pole) => {
        const active = isActive(pole, pathname);
        return (
          <Link
            key={pole.href}
            href={pole.href}
            aria-current={active ? "page" : undefined}
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: "var(--mobile-tabbar-row)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "5px",
              color: active ? "var(--c-ink)" : "var(--c-muted)",
              textDecoration: "none",
            }}
          >
            <span style={{ display: "flex" }}>
              {pole.icon(active ? "var(--c-gold)" : "currentColor")}
            </span>
            <span
              style={{
                font: `${active ? 600 : 500} 10.5px/1 ${FONT_SANS}`,
              }}
            >
              {pole.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

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

export type Pole = {
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
 * THE ASK POLE'S DESTINATION. One definition for the pole table and for every
 * back control that means "wherever the Ask pole goes".
 *
 * Three mobile screens draw a back control labelled Ask: `deals-screen.tsx`,
 * `feed-mobile-screen.tsx` and `trends-mobile/trends-screen.tsx`. Each one
 * had this route hardcoded, each comment said it aimed at "the Ask pole's own
 * destination", and PR #736 moved the pole from /intelligence to /ask without
 * touching any of them. Three copies of a rule with one owner is how that
 * happened, and it is the fourth time this repo has paid for it: see #713,
 * see #721, see #738, and a fourth copy of `slugToCompanyName`. The pole table
 * below reads this constant, the three screens import it, and the next pole
 * move is one edit. `tests/unit/ask-pole-href.test.ts` holds both halves of
 * that: no back control may carry the literal, and the Ask entry's href and
 * `owns` must both be this constant.
 *
 * ONE OTHER `/ask` LITERAL EXISTS and is deliberately not this constant. The
 * second one this note used to list, `ask-answer-screen.tsx`'s chevron with
 * `replace`, is gone: that screen is deleted and `?q=` is a state of the Ask
 * root rather than a second screen to come back from.
 *
 *   proxy.ts               `MOBILE_REDESIGN_DEV_PATHS`. This one CANNOT share
 *                          the constant: proxy runs as Node middleware outside
 *                          the React graph and importing a `"use client"`
 *                          module from it is not available. Structural, not a
 *                          choice, and the reason it is called out here rather
 *                          than fixed.
 *
 * It lives here, in the file that owns the pole table, rather than in a new
 * shared module, because the destination and the table have to move together.
 * The one constraint that buys: this module is `"use client"`, so every export
 * of it is a client reference when a Server Component imports it. All three
 * consumers are `"use client"` and the only importer of the bar itself
 * (`app-shell.tsx`) is too, so nothing crosses the boundary today.
 *
 * A SERVER COMPONENT MUST NOT IMPORT THIS, AND THE FAILURE IS SILENT. Measured
 * on a probe server page: `tsc` 0 errors, `build` exit 0, no warning anywhere.
 * On the server the export is a client-reference FUNCTION, not a string, so
 * `ASK_POLE_HREF === "/ask"` is false and `.startsWith` does not exist. A
 * string operation on it renders a JavaScript error message into the page as
 * an attribute value. Passing it straight to `href` happens to emit /ask,
 * which is accidental and must not be relied on. Nothing catches this; a
 * reader has to know it, which is why it is written here.
 */
export const ASK_POLE_HREF = "/ask";

/**
 * THE POLE'S NAME. One definition for the pole table and for every back
 * control that means "back to whichever pole this is".
 *
 * WHY IT IS BROWSE AND NOT ASK. The pole is named for an action and holds a
 * place. Behind it sit a company directory, three desks and one link to the
 * assistant, and the assistant is the smallest of the four. Ask named the
 * smallest thing on the screen; Browse names the place.
 *
 * WHY THE CONSTANT EXISTS AT ALL, and this is the more important half.
 * `ASK_POLE_HREF` centralised the route and NOTHING centralised the label.
 * The word sat as a bare JSX text node in three back controls one line under
 * an `href` that was already reading the constant, and
 * `tests/unit/ask-pole-href.test.ts` scanned those same three directories for
 * a stale route while being blind to a stale label directly beneath it. That
 * is PR 736's failure shape one field over: the comment stays true, the string
 * goes stale, tsc and lint and the build all pass, and the screen renders
 * perfectly with the wrong word on it. The test now bans the bare literal in
 * those three directories exactly as it bans the route.
 *
 * IT CARRIES THE SAME CLIENT-BOUNDARY HAZARD AS `ASK_POLE_HREF` ABOVE. This
 * module is `"use client"`, so on the server this export is a client-reference
 * function and not a string. `src/app/ask/page.tsx` is a Server Component and
 * therefore writes "Browse" out as a literal in its `pageTitle`, deliberately,
 * rather than importing this. Same reason, same silence, same note.
 *
 * THE DASHBOARD POLE HAS NO SUCH CONSTANT, and does not need one: its label is
 * rendered in exactly one place, the table below. A constant with one reader is
 * indirection, not a defence.
 */
export const BROWSE_POLE_LABEL = "Browse";

/**
 * The four poles, in the design's order.
 *
 * `owns` lists only routes whose pole is settled by the handoff's navigation
 * model. Routes whose pole is still an open question (/radar bare,
 * /radar/track-record, /radar/desk-record, /radar/theses) are deliberately
 * absent, so they light no pole rather than being assigned by guesswork.
 */
/* Exported for `tests/unit/ask-pole-href.test.ts`, which asserts the invariant
   the Ask entry's own comment states: a pole whose href is missing from its
   `owns` list goes dark the moment the reader arrives on it. Nothing in the
   app imports this; the bar renders it in place. */
export const POLES: Pole[] = [
  {
    /* RULING 17 RULED THIS ON 2026-08-26, together with Watch to Radar, as one
       decision. Only the Watch half shipped, and the mismatch the ruling cited
       as its own evidence stayed live for four days: `dashboard/page.tsx`
       renders `pageTitle="Dashboard"` while the pole under it read Today, so a
       reader tapped Today and landed on a page headed Dashboard. The other
       half ships here.

       The icon const below keeps its old spelling. Renaming a module-local
       identifier is churn with no reader-visible effect, and this file is the
       one place the label is drawn. */
    label: "Dashboard",
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
    label: "Radar",
    href: "/watch",
    icon: IconWatch,
    owns: ["/radar/watchlist", "/radar/following", "/watch"],
  },
  {
    /* THE HREF HAS MOVED TO /ask, under the same ruling the Radar pole above
       carries and for the same reason: move the href when the route READS A
       LOADER, not when it merely answers. PR #653 moved a pole against a screen
       with no read behind it and was closed for it.

       WHAT THE BAR WAS. The pole pointed at /intelligence. At 390 that route is
       the desk chat rendered full bleed: a sparkle tile, three prompt chips and
       a composer. No browse block, no directory, no company affordance of any
       kind. Meanwhile /ask, the designed mobile entry layer for this pole, had
       ZERO inbound links anywhere in src and drew a section headed "company
       intel" that nothing could reach.

       WHAT MADE IT TRUE. `src/lib/ask-companies-data.ts` reads `companies` and
       /ask renders it. That block used to list RECENT LOOKUPS, which nothing in
       the product records, and it shipped a notice saying so under an empty
       list. It is a directory now: real rows, real sectors, and every row's
       href proved to resolve against /company/[id] before it is built. A phone
       reader tapping this pole lands on a screen with a working read on it.

       WHAT SHIPPED AND WHAT DID NOT, so a reader of this file in six months
       does not have to guess:

         directory  SHIPS. The head of the mention-ordered read, rows linked at
                    a slug proved to land, a failed read distinguishable on
                    screen from a corpus with nothing in it.
         browse
         counters   UNWIRED still. The three destinations (Deal Flow, Trends,
                    Live Feed) are live and their figures are not: no defined
                    query and no defined interval. The screen says unwired
                    rather than drawing a quiet day.
         answer     NOT WIRED, deliberately. /ask?q= still draws "This surface
                    does not answer yet". DECISIONS.md Ruling 20 governs how it
                    may ever be wired: a client fetch behind an explicit submit,
                    never a server read of ?q=, because next/link prefetched
                    four full RSC renders of it with zero interaction.

       /intelligence STAYS IN `owns` and stays reachable. It is the surface the
       prompt chips open, it is not edited by this change, and reaching it must
       light Ask rather than nothing. `isActive` reads `owns` alone and never
       `href`, so /company, /deal-flow, /trends and /live-feed all still light
       this pole exactly as before. */
    label: BROWSE_POLE_LABEL,
    href: ASK_POLE_HREF,
    icon: IconAsk,
    owns: [
      "/intelligence",
      "/company",
      "/deal-flow",
      "/trends",
      "/live-feed",
      /* Step 9 and 10. /trends-mobile is the mobile Trends screen, which lands
         beside /trends rather than editing it. Without this entry it would
         light no pole, since the Ask pole owns /trends and not its sibling.
         /ask is this pole's destination as well as a member of its list, and it
         has to be both: `isActive` reads `owns` alone, so a pole whose href is
         missing from its own list goes dark the moment the reader arrives. */
      ASK_POLE_HREF,
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

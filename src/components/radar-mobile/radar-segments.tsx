"use client";

import Link from "next/link";
import {
  RADAR_TAB_LABEL,
  RADAR_TAB_ORDER,
  type RadarTab,
} from "@/components/radar/RadarTabs";
import { FONT_SANS } from "@/components/mobile/fonts";

/**
 * Radar's four sections, on a phone.
 *
 * WHY THIS EXISTS. Mobile Radar was one scrolling screen with a watchlist tier
 * and a following tier. The desk has four tabs, and Calls and Desk record were
 * reachable on the phone only under the Ledger, so a reader who knew the desk
 * arrived at Radar and found most of it missing. This row is the fix: the same
 * four sections, in the same order, under the same four words.
 *
 * IT IS A ROW OF LINKS, NOT A CLIENT SWITCH, and that is the structural
 * decision this component encodes. Each section is its own route under
 * `/watch`, so each pays for exactly its own read: the Following segment does
 * not load 172 graded rows, and the record segment does not load a watchlist.
 * A client-state segmented control would have to hold all four datasets in one
 * payload, would give the four sections one URL between them, and would make
 * the back gesture leave Radar rather than step back a section. See
 * `decisions/mobile-radar-mirrors-the-desk.md`.
 *
 * THE WORDS COME FROM THE DESK. `RADAR_TAB_LABEL` and `RADAR_TAB_ORDER` are the
 * desk's own table, imported rather than retyped, so the two surfaces cannot
 * come to disagree about what Radar is made of. That is the whole defect this
 * work exists to close, and re-spelling the words here would reintroduce it in
 * the same commit that fixes it. `tests/unit/radar-segments.test.ts` holds the
 * agreement.
 *
 * THE HREFS ARE THIS SURFACE'S OWN. `/watch` is the Radar pole's destination
 * and `isActive` in `mobile-tab-bar.tsx` matches a path prefix, so all four
 * routes light the Radar pole with no edit to the pole table. The first
 * section's href is the bare pole route rather than `/watch/following`, so
 * tapping a lit pole lands on a section rather than on a redirect.
 *
 * GEOMETRY. Four equal columns, full bleed, so the row measures 80px per cell
 * at 320 and nothing has to scroll sideways. `boxSizing: content-box` keeps the
 * 1px rule outside the drawn 48px, which is the same box model `BackHeader`
 * carries and offers as a prop for this exact reason. The cells are grid tracks
 * rather than a flex row with gaps because a track cannot be squeezed below its
 * share, so the fourth word can never be pushed off the edge by the first
 * three. Measurements at 320, 375, 390 and 430 are in the PR body.
 *
 * NO STICKY. The row scrolls away with the screen. A sticky row here would sit
 * under the notch on a full-bleed screen and would compete with the fixed tab
 * bar at the other edge for a reader's sense of where the page begins.
 */

const HREF: Record<RadarTab, string> = {
  following: "/watch",
  watchlist: "/watch/watchlist",
  calls: "/watch/calls",
  "desk-record": "/watch/desk-record",
};

/** Exported for the unit test, which asserts every section has a route. */
export const RADAR_SEGMENT_HREF = HREF;

export function RadarSegments({ active }: { active: RadarTab }) {
  return (
    <nav
      aria-label="Radar sections"
      style={{
        /* The rule sits outside the drawn 48px rather than eating a pixel of
           it. Same construction as BackHeader's `boxSizing` prop. */
        boxSizing: "content-box",
        flex: "none",
        minHeight: "48px",
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        borderBottom: "1px solid var(--c-border)",
        backgroundColor: "var(--c-bg)",
      }}
    >
      {RADAR_TAB_ORDER.map((key) => {
        const on = key === active;
        return (
          <Link
            key={key}
            href={HREF[key]}
            aria-current={on ? "page" : undefined}
            style={{
              /* The whole track is the target: 80px by 44px at 320, which is
                 the narrowest this row is ever drawn. */
              minWidth: 0,
              minHeight: "44px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
              padding: "0 2px",
              textAlign: "center",
              textDecoration: "none",
              font: `${on ? 600 : 500} 12px/1.2 ${FONT_SANS}`,
              color: on ? "var(--c-ink)" : "var(--c-muted)",
            }}
          >
            {RADAR_TAB_LABEL[key]}
            {on ? (
              /* The active mark sits ON the rule, not above it, so the row
                 reads as one edge with a lit segment rather than as two
                 stacked lines. `bottom: -1px` puts it over the border the nav
                 draws, which is why the nav owns that border and the cell does
                 not. */
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: "10px",
                  right: "10px",
                  bottom: "-1px",
                  height: "2px",
                  backgroundColor: "var(--c-gold)",
                }}
              />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

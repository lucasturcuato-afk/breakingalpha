"use client";

/**
 * The way off `/company/[id]` on the DESK, at `md` and above.
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHAT WAS WRONG. There was no way back at all.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `CompanyDetailLayout` draws a header, an alias ribbon, a KPI strip, seven
 * tab panels and a right rail, and not one control that returns a reader to
 * where they came from. A reader reaches this route from the Company Intel
 * directory, from the search box, from a watchlist row, or from a link someone
 * sent them, and every one of those arrivals ends in a screen whose only
 * outbound navigation is the sidebar's own poles. The sidebar can offer
 * "Company Intel"; it cannot offer "the watchlist you were reading".
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHY IT IS NOT `router.back()`, WHICH IS WHAT THE PHONE HAD.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `company-intel-screen.tsx` shipped a bare `<button onClick={() =>
 * router.back()}>`. That is the defect PR 746 exists to fix, and this route is
 * the worst place in the product to carry it: a company link is the link that
 * gets pasted into Slack, mail and a search result, so a cold entry here is the
 * COMMON arrival rather than the edge one. On a cold entry `router.back()` has
 * two outcomes and neither is navigation inside Signalera. Either the entry is
 * the first of the tab and the call is a no-op, so the control is dead and the
 * reader is still stuck; or something foreign is behind it and the reader is
 * put back on Slack. A dead control is a wrong room. An ejection is a wrong
 * building.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE RULE IS IMPORTED, NOT RESTATED. THIS IS THE LOAD-BEARING PART.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `shouldStepBack` and `readAppHistory` live once, in
 * `src/components/mobile/history-back.ts`, and that file carries the measured
 * numbers behind them. This component calls them; it does not reach for
 * `navigation.currentEntry` and it does not read `history.length`. Two paths
 * computing "is a page of ours behind this one" is the failure this repo keeps
 * paying for, and it had already happened here: `EmptyState.tsx` grew a private
 * `hasOurPageBehind()` because the shared module was still in flight. That copy
 * is gone in the same change that adds this file, so after it there are exactly
 * TWO call sites and ONE rule:
 *
 *   BackHeader        screen-chrome.tsx    the 48px phone header row
 *   CompanyBackLink   this file           the inline desk link
 *
 * Both import from `history-back.ts`. `tests/unit/company-back-control.test.ts`
 * asserts that and asserts nothing under `src/components/company/` computes the
 * index itself.
 *
 * WHY TWO CALL SITES AND NOT ONE. The two anatomies are genuinely different
 * objects. `BackHeader` is a full-bleed 48px row with a hairline under it,
 * which is a phone screen's head; this is a 12px muted inline link sitting
 * inside the desk layout's own padded column. Collapsing them would mean a
 * `variant` prop on a component that then draws two unrelated boxes, which is
 * more duplication wearing fewer files. The RULE is what must not fork, and it
 * has not.
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHY IT IS A `Link` AND NOT A `<button>`.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The `href` is the fallback, not decoration. When nothing of ours is behind
 * the page the handler does nothing at all and the anchor navigates by itself,
 * to a destination that is STATED rather than guessed. That also keeps
 * cmd-click and middle-click opening the directory in a new tab, which is why
 * `isPlainLeftClick` is consulted before anything else: a new context has no
 * history of ours in it, so a modified click must reach the browser untouched.
 *
 * WHAT IT DOES, IN THE TWO CASES A READER ACTUALLY MEETS:
 *
 *   step-back entry  index > 0   preventDefault, router.back(), and the reader
 *                                returns to the directory / search / watchlist
 *                                row they came from, scroll position intact
 *   cold entry       index 0     the handler returns, the anchor runs, and the
 *                                reader lands on /company
 *
 * The second case covers a cold tab, a link opened from Slack or a search
 * result, AND a reader who has already walked back to where they came in.
 * `history.length` cannot tell the third of those from the first two, which is
 * the whole reason the rule reads the Navigation API's index instead.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import type { MouseEvent } from "react";

import {
  isPlainLeftClick,
  readAppHistory,
  shouldStepBack,
} from "@/components/mobile/history-back";

import { COMPANY_BACK_HREF, COMPANY_BACK_LABEL } from "./back-destination";

export function CompanyBackLink() {
  const router = useRouter();

  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!isPlainLeftClick(event)) return;
    if (!shouldStepBack(readAppHistory())) {
      /* Nothing of OURS is behind this page. The anchor is left alone and
         navigates to COMPANY_BACK_HREF on its own. */
      return;
    }
    event.preventDefault();
    router.back();
  }

  return (
    <Link
      href={COMPANY_BACK_HREF}
      data-testid="company-back-link"
      onClick={onClick}
      /* DISPLAY LIVES IN A CLASS AND NEVER IN THE STYLE OBJECT. An inline
         `display` beats a responsive class at every breakpoint, which is
         design-lint's rule 10 and the defect that shipped the tab bar to
         desktop once already. A caller that needs to gate this by width wraps
         it, the way EmptyState does. */
      className="inline-flex w-fit items-center gap-1.5 font-sans text-[12px] text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold rounded-md"
      /* 44px is the target `legal-up-link.tsx` argues for and builds at, for
         the same reason: a back control a reader has to aim at is a back
         control they do not use. `minHeight` is not `display`, so no class
         here is fighting an inline value. */
      style={{ minHeight: 44, textDecoration: "none" }}
    >
      <ChevronLeft size={16} aria-hidden="true" />
      {COMPANY_BACK_LABEL}
    </Link>
  );
}

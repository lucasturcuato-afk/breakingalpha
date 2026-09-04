import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The anchor that opens a legal document from a line of small print.
 *
 * WHY THIS EXISTS AT ALL. `/auth` renders "By continuing, you agree to
 * Signalera's Terms of Service and Privacy Policy." on both layouts, and on
 * both layouts it was plain text. Measured at 390 before that change, `/auth`
 * had zero visible links of any kind: the page asserted an agreement to two
 * documents a reader could not open from it. That is the defect, and it is the
 * whole reason for this component.
 *
 * IT NOW SERVES FOUR CALL SITES, NOT TWO, and the two new ones are the reason
 * this paragraph exists. `/waitlist` and `/share/brief/[id]` are both reachable
 * with no session, and measured signed out at 320, 390 and 1440 neither carried
 * a single link into `/legal`: `/waitlist` had one mailto and a link home,
 * `/share/brief/[id]` had a wordmark and two sign-up buttons. Both surfaces
 * carry exactly the problem this component was written for, a line of small
 * print naming things a reader cannot open, so both use it rather than growing
 * a second way to do the same job.
 *
 * THE NEW CALL SITES POINT AT THE HUB AND SPELL OUT ITS THREE ROWS,
 * "Terms, privacy and support", where `/auth` names one document each. That is
 * a measurement, not a preference. This component grows the hit area on the
 * block axis only, which is all `/auth` ever needed because "Terms of Service"
 * is wide on its own. A one-word label is not: "Legal" measured 31.16 by 48 on
 * `/waitlist`, clearing the floor on height and missing it on width by 13px.
 * Inline padding here would fix that and would also pull the full stop after
 * the second `/auth` anchor 9px left, under its own underline. So the label
 * does the work, and the component stays exactly as `/auth` shipped it.
 *
 * WHY IT IS SHARED RATHER THAN WRITTEN TWICE. `src/app/auth/page.tsx` and
 * `src/components/auth/mobile-auth.tsx` draw the same sentence with different
 * typography, so the sentence itself stays in each file, apostrophe and all,
 * and only the load-bearing part is shared: the destination and the hit area.
 * This repo has paid for one-rule-many-implementations enough times that
 * `screen-chrome.tsx` keeps a list of them.
 *
 * THE HIT AREA IS THE HARD PART. The sentence is 11px on both layouts, so a
 * bare anchor is a 13px tap target on desktop and a 17.6px one on mobile,
 * against a 44px floor. The fix is the pattern `settings/alerts/page.tsx`
 * already ships, with one correction: block padding grows the hit area and an
 * equal negative block margin gives it straight back to the line box, so the
 * paragraph occupies exactly the height it did before. Measured on a production
 * build by cloning the live paragraph and flattening the anchors back to plain
 * text: 35.19px against 35.19px at 320 and 390, and 17.59px against 17.59px at
 * 1440. Not close, identical.
 *
 * NO `minHeight`. The alerts pattern pins 20px, and pinning it here would have
 * forced a 17.6px line box to 20px on both layouts, a visible change to a
 * desktop page that is not in scope. Leaving the height to the content clears
 * the floor on its own: 17.6px of line box plus 32px of padding measures 49.6px
 * on both, and 49.6 clears 44 without touching a single line box.
 *
 * `content-box` is not decoration; the app sets `border-box` globally, under
 * which the padding would eat the content instead of adding to it.
 *
 * `inline-flex` rather than `inline` is deliberate. An atomic inline-level box
 * cannot be split across two lines, so its rect is one rectangle and its centre
 * is always inside it. A plain inline anchor that wrapped mid-phrase would
 * report a union rect whose centre sits between the two fragments and hits
 * neither.
 *
 * The anchors are underlined. An 11px colour shift alone is not an affordance
 * at that size, and the point of the change is that a reader can tell these two
 * phrases are openable.
 */
export function LegalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        boxSizing: "content-box",
        display: "inline-flex",
        alignItems: "center",
        padding: "16px 0",
        margin: "-16px 0",
        color: "var(--c-goldink)",
        textDecoration: "underline",
        textUnderlineOffset: "2px",
      }}
    >
      {children}
    </Link>
  );
}

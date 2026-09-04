import Link from "next/link";
import { ChevronLeft } from "lucide-react";

/**
 * The way from a legal document back to the legal hub.
 *
 * WHY IT EXISTS. `/legal` had exactly one inbound link in the whole of `src/`,
 * the Settings row, and `/settings/profile` answers 307 to `/auth` without a
 * session. So a signed-out reader who followed the sign-in small print into
 * `/legal/terms` could reach the hub in no finite number of taps, and Support
 * with it. The two documents are where that reader lands, so the two documents
 * are where the link has to be.
 *
 * WHY AT THE TOP AND NOT AT THE FOOT. The layout footer already carries
 * cross-links at the foot, and they are the 17.6px targets this whole change
 * exists to stop depending on. A control the reader has to scroll a full legal
 * document to find is a control they will not find. This sits above the H1,
 * visible on arrival, at a measured 44px.
 *
 * WHY IT NAMES ITS DESTINATION RATHER THAN SAYING "BACK".
 * `screen-chrome.tsx` states the rule and the reason: a control that promises
 * a specific destination must say which, because a reader who arrived here
 * from a search result has nothing of ours behind them. It says "Legal", which
 * is the destination's own H1.
 *
 * IT RENDERS AT EVERY WIDTH, and that is a deliberate, additive change to two
 * pages that already shipped. A hub reachable only below `md` is an orphan on
 * desktop, since the Settings row that points at it is a phone screen. Two
 * documents that behave differently by width for no reason a reader can see is
 * worse than one small link.
 */
export function LegalUpLink() {
  return (
    <Link
      href="/legal"
      className="font-sans hover:text-gold-dark transition-colors"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        minWidth: 44,
        minHeight: 44,
        marginBottom: 4,
        fontSize: 13,
        fontWeight: 500,
        color: "var(--text-muted)",
        textDecoration: "none",
      }}
    >
      <ChevronLeft size={16} />
      Legal
    </Link>
  );
}

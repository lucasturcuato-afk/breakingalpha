"use client";

/**
 * RadarTabs — the Radar surface's sub-tabs (Following / Watchlist / Calls /
 * Desk record). Rendered inside each /radar page's AppShell content, so every
 * sub-tab keeps its own page (and its own data fetching) while sharing
 * one navigation spine. Inter for the functional tab row; the active tab
 * carries the gold hairline.
 *
 * `context` marks auxiliary workspaces that live under Radar but are not
 * one of the three sub-tabs (the preserved Thesis Board workspace and
 * Thesis Tracker); it renders as a quiet suffix after the tabs.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";

export type RadarTab = "following" | "watchlist" | "calls" | "desk-record";

/**
 * THE FOUR WORDS RADAR IS MADE OF, and the one place they are written.
 *
 * The mobile surface renders the same four sections under `/watch`, and the
 * complaint that opened that work was precisely that the two structures had
 * drifted apart. A second literal copy of these strings is how they drift
 * again, silently, with tsc and lint and the build all green. This repo has
 * paid for one-rule-many-implementations at least five times (PR 713, PR 721,
 * PR 736, PR 738, and four copies of `slugToCompanyName`), and PR 736's own
 * failure was a LABEL going stale one line under an href that was already
 * reading a constant.
 *
 * So the desk's tab row and the phone's segment row read the same table.
 * `tests/unit/radar-segments.test.ts` asserts the two agree on every key, every
 * word and the order, so renaming a section here is red until the phone
 * follows.
 *
 * The hrefs are deliberately NOT here. They differ by surface (`/radar/*` on
 * the desk, `/watch/*` on the phone) and sharing them would be sharing a
 * coincidence rather than a rule.
 *
 * THE CLIENT-BOUNDARY HAZARD APPLIES, exactly as it does to `ASK_POLE_HREF` in
 * `mobile-tab-bar.tsx`: this module is `"use client"`, so on the server every
 * export of it is a client reference and not a string. Both consumers of this
 * table are `"use client"`. A Server Component must write the word out as a
 * literal instead, and nothing warns when it does not.
 */
export const RADAR_TAB_LABEL: Record<RadarTab, string> = {
  following: "Following",
  watchlist: "Watchlist",
  calls: "Calls",
  // The desk's own graded record, distinct from the user's record on Calls.
  "desk-record": "Desk record",
};

/** The order the sections are read in, on both surfaces. */
export const RADAR_TAB_ORDER: RadarTab[] = [
  "following",
  "watchlist",
  "calls",
  "desk-record",
];

const TABS: { key: RadarTab; label: string; href: string }[] = [
  { key: "following", label: RADAR_TAB_LABEL.following, href: "/radar/following" },
  { key: "watchlist", label: RADAR_TAB_LABEL.watchlist, href: "/radar/watchlist" },
  { key: "calls", label: RADAR_TAB_LABEL.calls, href: "/radar/calls" },
  { key: "desk-record", label: RADAR_TAB_LABEL["desk-record"], href: "/radar/desk-record" },
];

/* Exit duration mirrors --duration-page-exit in tokens.css. Kept as a
   constant because the navigation timeout must match the CSS. */
const PAGE_EXIT_MS = 240;

export function RadarTabs({
  active,
  context,
}: {
  active: RadarTab | null;
  context?: string;
}) {
  const router = useRouter();

  /* Exit + enter, not a hard swap: fade the outgoing page (the nearest
     [data-radar-page] wrapper) out, then navigate; the incoming page
     plays motion-page-enter on mount. Reduced-motion users navigate
     immediately. Falls back to plain navigation when no wrapper exists. */
  const navigate = (e: React.MouseEvent, href: string, isActive: boolean) => {
    if (isActive || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    const page = document.querySelector<HTMLElement>("[data-radar-page]");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!page || reduced) return; // let Link navigate normally
    e.preventDefault();
    page.classList.remove("motion-page-enter");
    page.classList.add("motion-page-exit");
    router.prefetch(href);
    window.setTimeout(() => router.push(href), PAGE_EXIT_MS);
  };

  return (
    <nav
      aria-label="Radar sections"
      className="mb-5 flex items-baseline gap-1 border-b border-border-subtle font-sans"
    >
      <span className="mr-3 pb-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-faint">
        Radar
      </span>
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            onClick={(e) => navigate(e, tab.href, isActive)}
            aria-current={isActive ? "page" : undefined}
            className={
              "relative px-3 pb-2.5 text-[13px] transition-colors " +
              (isActive
                ? "font-semibold text-text-primary"
                : "font-medium text-text-muted hover:text-text-primary")
            }
          >
            {tab.label}
            {isActive && (
              <span
                aria-hidden
                className="absolute inset-x-2 -bottom-px h-[2px]"
                style={{ backgroundColor: "var(--gold)" }}
              />
            )}
          </Link>
        );
      })}
      {context && (
        <span className="ml-3 pb-2.5 text-[12px] italic text-text-faint">
          {context}
        </span>
      )}
    </nav>
  );
}

export default RadarTabs;

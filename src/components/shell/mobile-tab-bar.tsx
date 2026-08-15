"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

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
    label: "Ledger",
    href: "/morning-brief",
    icon: IconLedger,
    owns: ["/morning-brief", "/evening-wrap", "/radar/calls"],
  },
  {
    label: "Watch",
    href: "/radar/watchlist",
    icon: IconWatch,
    owns: ["/radar/watchlist", "/radar/following"],
  },
  {
    label: "Ask",
    href: "/intelligence",
    icon: IconAsk,
    owns: ["/intelligence", "/company", "/deal-flow", "/trends", "/live-feed"],
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
                font: `${active ? 600 : 500} 10.5px/1 Inter, sans-serif`,
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

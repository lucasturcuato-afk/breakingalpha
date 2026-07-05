"use client";

/**
 * RadarTabs — the Radar surface's three sub-tabs (Following / Watchlist /
 * Calls). Rendered inside each /radar page's AppShell content, so every
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

export type RadarTab = "following" | "watchlist" | "calls";

const TABS: { key: RadarTab; label: string; href: string }[] = [
  { key: "following", label: "Following", href: "/radar/following" },
  { key: "watchlist", label: "Watchlist", href: "/radar/watchlist" },
  { key: "calls", label: "Calls", href: "/radar/calls" },
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

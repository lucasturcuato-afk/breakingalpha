"use client";

/**
 * CompanyDetailLayout
 *
 * Slot-pattern shell for the company detail page. Composes header / alias
 * ribbon / KPI strip / tab strip / active tab panel / right rail / bottom.
 * Owns:
 *  - URL-synced tab state (via useCompanyTabState)
 *  - Global keyboard handler (Alt+1..9 jump, [ / ] cycle)
 *
 * Per-tab content is NOT defined here. Callers pass a tabContent record
 * keyed by CompanyTabId; only the active tab's content is rendered into
 * the tabpanel. PR-C1..D1 fill in the panels.
 *
 * Visual frame mirrors docs/DirectionD.jsx lines 495-528 (Detail body),
 * notably the 1.55fr / 1fr two-column grid above the bottom row.
 *
 * Keyboard bail conditions (mirrors src/app/company/page.tsx:540-564):
 *  - Focus inside <input>, <textarea>, or contenteditable
 *  - Focus on an in-page anchor (a[href^="#"]) so skip links keep working
 */

import { useEffect } from "react";
import type { ReactNode } from "react";

import {
  TAB_ORDER,
  useCompanyTabState,
  type CompanyTabId,
} from "@/hooks/useCompanyTabState";

import { CompanyDetailTabs } from "./CompanyDetailTabs";

export interface CompanyDetailLayoutProps {
  /** Map of tab id to its content. Missing entries render an empty panel. */
  tabContent: Partial<Record<CompanyTabId, ReactNode>>;
  /**
   * The way off this route, drawn above the header.
   *
   * OPTIONAL, AND THAT IS NOT A HEDGE. This layout is a slot shell and every
   * other slot on it is optional, so a required prop here would be the one
   * inconsistency; the route that owns the surface passes
   * `<CompanyBackLink />` and the prop exists so it does not have to render it
   * outside this container, where it would sit on the shell's own ground with
   * none of the padding the column supplies.
   */
  backSlot?: ReactNode;
  /** CompanyHeader (PR-B1). */
  header?: ReactNode;
  /** CompanyAliasRibbon (PR-B1). */
  aliasRibbon?: ReactNode;
  /** KPIStrip (PR-B2). */
  kpiStrip?: ReactNode;
  /** Right rail content (TrendCard + ThemesCard). */
  rightRail?: ReactNode;
  /** Optional below-fold row. Unused by the company page today. */
  bottom?: ReactNode;
  /** Optional outer wrapper className for caller-side adjustments. */
  className?: string;
}

export function CompanyDetailLayout({
  tabContent,
  backSlot,
  header,
  aliasRibbon,
  kpiStrip,
  rightRail,
  bottom,
  className,
}: CompanyDetailLayoutProps) {
  const { activeTab, setActiveTab, cycleTab } = useCompanyTabState();

  useEffect(() => {
    function handle(e: KeyboardEvent) {
      const active = document.activeElement as HTMLElement | null;
      const tag = (active?.tagName || "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (active?.isContentEditable) return;
      // Skip-link-aware: don't intercept keys when focus is on an in-page
      // anchor. Mirrors the bail in src/app/company/page.tsx (PR #213 fix).
      if (active?.matches?.('a[href^="#"]')) return;

      if (e.altKey && e.key >= "1" && e.key <= "9") {
        const idx = parseInt(e.key, 10) - 1;
        if (idx >= 0 && idx < TAB_ORDER.length) {
          e.preventDefault();
          setActiveTab(TAB_ORDER[idx]);
        }
        return;
      }
      if (e.key === "]") {
        e.preventDefault();
        cycleTab(1);
        return;
      }
      if (e.key === "[") {
        e.preventDefault();
        cycleTab(-1);
      }
    }

    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [setActiveTab, cycleTab]);

  return (
    <div
      data-testid="company-detail-layout"
      className={[
        "flex flex-col gap-[14px] bg-cream p-4 text-text-primary",
        className ?? "",
      ].join(" ")}
    >
      {backSlot}
      {header}
      {aliasRibbon}
      {kpiStrip}

      <CompanyDetailTabs
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.55fr_1fr] items-start">
        {/*
          WD113: render ALL tab panels at all times; hide inactive panels via
          `display: none`. Conditionally rendering `tabContent[activeTab]`
          unmounts the previous tab on every switch, which re-fires data
          fetches (`/api/memo-cache`, `/api/stock-chart`) and discards any
          in-flight requests + local React state. Keeping panels mounted
          preserves cached data and avoids redundant network traffic.
          Layers on top of WD95 (RSC refetch fix).
        */}
        <div className="min-w-0">
          {TAB_ORDER.map((id) => {
            const content = tabContent[id];
            if (!content) return null;
            const isActive = id === activeTab;
            return (
              <div
                key={id}
                role="tabpanel"
                id={`tabpanel-${id}`}
                aria-labelledby={`tab-${id}`}
                data-testid={`tab-panel-${id}`}
                tabIndex={0}
                hidden={!isActive}
                className="min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold rounded-md"
              >
                {content}
              </div>
            );
          })}
        </div>
        {rightRail ? (
          <div className="flex flex-col gap-[14px] min-w-0">{rightRail}</div>
        ) : null}
      </div>

      {bottom}
    </div>
  );
}

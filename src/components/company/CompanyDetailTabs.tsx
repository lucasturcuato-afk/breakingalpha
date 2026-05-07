"use client";

/**
 * F1-F9 ARIA tablist for the company detail page.
 *
 * Pure UI: receives activeTab + setActiveTab from CompanyDetailLayout.
 * Visual frame mirrors docs/DirectionD.jsx lines 613-645 (FunctionTabs).
 *
 * Mobile: horizontally scrollable on viewports < 768px (lg breakpoint
 * stack handled by parent layout); we set overflow-x-auto + no-scrollbar
 * so the strip never wraps.
 */

import type { CompanyTabId } from "@/hooks/useCompanyTabState";
import { TAB_ORDER } from "@/hooks/useCompanyTabState";

const TAB_LABELS: Record<CompanyTabId, string> = {
  brief: "Brief",
  articles: "Articles",
  themes: "Themes",
  trend: "Trend",
  sources: "Sources",
  filings: "Filings",
  transcripts: "Transcripts",
  insider: "Insider",
  comps: "Comps",
};

interface CompanyDetailTabsProps {
  activeTab: CompanyTabId;
  setActiveTab: (id: CompanyTabId) => void;
  className?: string;
}

export function CompanyDetailTabs({
  activeTab,
  setActiveTab,
  className,
}: CompanyDetailTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Company detail sections"
      data-testid="tab-strip"
      className={[
        "flex items-center gap-1 overflow-x-auto no-scrollbar",
        "border-b border-border-base py-1",
        className ?? "",
      ].join(" ")}
    >
      {TAB_ORDER.map((id, i) => {
        const slot = `F${i + 1}`;
        const isActive = activeTab === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tab-${id}`}
            aria-selected={isActive}
            aria-controls={`tabpanel-${id}`}
            tabIndex={isActive ? 0 : -1}
            data-testid={`tab-${id}`}
            onClick={() => setActiveTab(id)}
            className={[
              "inline-flex items-center gap-[7px] shrink-0",
              "px-[11px] py-[5px] rounded-[5px]",
              "border transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-1",
              isActive
                ? "border-gold-border bg-cream-hi"
                : "border-border-base bg-transparent hover:bg-cream-hi",
            ].join(" ")}
          >
            <span
              className={[
                "font-data text-[9.5px] font-bold",
                isActive ? "text-gold-dark" : "text-text-faint",
              ].join(" ")}
            >
              {slot}
            </span>
            <span
              className={[
                "font-sans text-[12px]",
                isActive
                  ? "font-semibold text-espresso"
                  : "font-medium text-text-secondary",
              ].join(" ")}
            >
              {TAB_LABELS[id]}
            </span>
          </button>
        );
      })}
      <span
        data-testid="tab-shortcut-hint"
        className="ml-auto pl-3 font-data text-[10px] text-text-faint shrink-0"
      >
        Option+number to jump
      </span>
    </div>
  );
}

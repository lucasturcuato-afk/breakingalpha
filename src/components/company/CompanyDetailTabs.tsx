"use client";

/**
 * ARIA tablist for the company detail page.
 *
 * Pure UI: receives activeTab + setActiveTab from CompanyDetailLayout.
 * Keyboard shortcuts (Alt+1..9, [ / ]) are wired in CompanyDetailLayout
 * but intentionally not surfaced in the UI.
 *
 * Mobile: horizontally scrollable on viewports < 768px (lg breakpoint
 * stack handled by parent layout); we set overflow-x-auto + no-scrollbar
 * so the strip never wraps.
 */

import type { CompanyTabId } from "@/hooks/useCompanyTabState";
import { TAB_ORDER } from "@/hooks/useCompanyTabState";
import { InfoTooltip } from "@/components/ui/info-tooltip";

const TAB_LABELS: Record<CompanyTabId, string> = {
  brief: "Brief",
  articles: "Articles",
  themes: "Themes",
  trend: "Price & Tone",
  sources: "Sources",
  filings: "Filings",
  financials: "Financials",
  transcripts: "Transcripts",
  insider: "Insider",
  comps: "Comps",
};

const TAB_TIPS: Partial<Record<CompanyTabId, string>> = {
  brief: "AI-generated company brief synthesized from recent articles and filings.",
  articles: "All indexed articles mentioning this company, sorted by recency.",
  filings: "SEC filings (10-K, 10-Q, 8-K) pulled from EDGAR for this company.",
  financials: "Key financial metrics extracted from validated XBRL filings.",
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
        "border-b border-border-subtle py-1",
        className ?? "",
      ].join(" ")}
    >
      {TAB_ORDER.map((id) => {
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
              "relative inline-flex items-center gap-[7px] shrink-0",
              "px-[11px] py-[5px] rounded-[5px]",
              "border motion-safe:transition-all motion-safe:duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-1",
              isActive
                ? "border-gold-border bg-cream-hi shadow-[inset_0_-2px_0_0_var(--gold)]"
                : "border-border-base bg-transparent hover:bg-cream-hi hover:border-border-hi motion-safe:hover:-translate-y-[1px]",
            ].join(" ")}
          >
            <span
              className={[
                "font-sans text-[12px] motion-safe:transition-colors motion-safe:duration-150",
                isActive
                  ? "font-semibold text-espresso"
                  : "font-medium text-text-secondary group-hover:text-espresso hover:text-espresso",
              ].join(" ")}
            >
              {TAB_LABELS[id]}
            </span>
            {TAB_TIPS[id] && (
              <InfoTooltip content={TAB_TIPS[id]} side="bottom" iconSize={10} />
            )}
          </button>
        );
      })}
    </div>
  );
}

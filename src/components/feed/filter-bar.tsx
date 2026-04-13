"use client";

import { cn } from "@/lib/utils";
import { getVerticalStyle, getActivityTypeStyle } from "@/lib/sector-colors";
import { Bell, Bookmark } from "lucide-react";

const INDUSTRY_VERTICALS = [
  "Technology", "Healthcare & Biotech", "Energy & Oil/Gas", "Financial Services",
  "Consumer & Retail", "Industrials & Manufacturing", "Aerospace & Defense",
  "Real Estate", "Media & Telecom", "Materials & Mining", "Agriculture",
];

const ACTIVITY_TYPES = [
  "Mergers & Acquisitions", "Private Equity", "Venture Capital", "IPO & Capital Markets",
  "Earnings & Results", "Macro & Policy", "Geopolitics", "Regulation & Legal",
  "Fundraising", "Crypto & Digital Assets", "Leadership & Operations",
];

const INACTIVE_CHIP_STYLE = {
  backgroundColor: "transparent",
  color: "#9ca3af",
  borderColor: "#374151",
  borderWidth: 1,
  borderStyle: "solid" as const,
};

interface FilterBarProps {
  selectedVerticals: string[];
  selectedActivityTypes: string[];
  onVerticalToggle: (v: string) => void;
  onActivityTypeToggle: (a: string) => void;
  showAlertsOnly: boolean;
  onAlertsToggle: () => void;
  showSavedOnly: boolean;
  onSavedToggle: () => void;
  alertCount?: number;
}

export function FilterBar({
  selectedVerticals,
  selectedActivityTypes,
  onVerticalToggle,
  onActivityTypeToggle,
  showAlertsOnly,
  onAlertsToggle,
  showSavedOnly,
  onSavedToggle,
  alertCount = 0,
}: FilterBarProps) {
  return (
    <div className="bg-parchment px-6 pt-2 pb-1 space-y-1">
      {/* Row 1: Industry Verticals */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
        {INDUSTRY_VERTICALS.map((v) => {
          const isActive = selectedVerticals.includes(v);
          const style = getVerticalStyle(v);
          return (
            <button
              key={v}
              type="button"
              onClick={() => onVerticalToggle(v)}
              style={
                isActive
                  ? {
                      backgroundColor: style.bg,
                      color: style.text,
                      borderColor: style.border,
                      borderWidth: 1,
                      borderStyle: "solid",
                    }
                  : INACTIVE_CHIP_STYLE
              }
              className="flex-shrink-0 px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap transition-all cursor-pointer"
            >
              {v}
            </button>
          );
        })}
      </div>

      {/* Subtle separator */}
      <div className="border-t border-border-subtle/50" />

      {/* Row 2: Activity Types */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
        {ACTIVITY_TYPES.map((a) => {
          const isActive = selectedActivityTypes.includes(a);
          const style = getActivityTypeStyle(a);
          return (
            <button
              key={a}
              type="button"
              onClick={() => onActivityTypeToggle(a)}
              style={
                isActive
                  ? {
                      backgroundColor: style.bg,
                      color: style.text,
                      borderColor: style.border,
                      borderWidth: 1,
                      borderStyle: "solid",
                    }
                  : INACTIVE_CHIP_STYLE
              }
              className="flex-shrink-0 px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap transition-all cursor-pointer"
            >
              {a}
            </button>
          );
        })}
      </div>

      {/* Row 3: Alerts + Saved toggle buttons */}
      <div className="flex items-center gap-2 pb-0.5">
        <button
          type="button"
          onClick={onAlertsToggle}
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-medium border",
            "transition-all duration-[var(--duration-base)] ease-[var(--ease-out)] cursor-pointer",
            showAlertsOnly
              ? "bg-red-500/10 text-red-400 border-red-500/20"
              : "bg-transparent text-text-faint border-border-subtle hover:text-text-muted hover:border-border-base",
          )}
        >
          <Bell size={10} />
          Alerts
          {alertCount > 0 && (
            <span className={cn(
              "text-[9px] font-bold min-w-[16px] h-4 flex items-center justify-center rounded px-1",
              showAlertsOnly ? "bg-red-500/20 text-red-300" : "bg-border-base text-text-muted",
            )}>
              {alertCount}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onSavedToggle}
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-medium border",
            "transition-all duration-[var(--duration-base)] ease-[var(--ease-out)] cursor-pointer",
            showSavedOnly
              ? "bg-gold/10 text-gold border-gold/20"
              : "bg-transparent text-text-faint border-border-subtle hover:text-text-muted hover:border-border-base",
          )}
        >
          <Bookmark size={10} />
          Saved
        </button>
      </div>
    </div>
  );
}

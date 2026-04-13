"use client";

import { cn } from "@/lib/utils";

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

interface SectorsStepProps {
  selectedVerticals: string[];
  selectedActivityTypes: string[];
  onVerticalToggle: (v: string) => void;
  onActivityTypeToggle: (a: string) => void;
}

export function SectorsStep({
  selectedVerticals,
  selectedActivityTypes,
  onVerticalToggle,
  onActivityTypeToggle,
}: SectorsStepProps) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-[22px] font-extrabold text-espresso mb-1">
          Pick your focus areas
        </h2>
        <p className="font-sans text-[13px] text-text-secondary">
          Select sectors and deal types you want to track. You can change these anytime.
        </p>
      </div>

      {/* Industry Verticals */}
      <div>
        <p className="font-sans text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-2">
          Industry Verticals
        </p>
        <div className="flex flex-wrap gap-2">
          {INDUSTRY_VERTICALS.map((v) => {
            const isSelected = selectedVerticals.includes(v);
            return (
              <button
                key={v}
                type="button"
                onClick={() => onVerticalToggle(v)}
                className={cn(
                  "px-3.5 py-2 rounded-lg border",
                  "font-sans text-[12px] font-medium",
                  "transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
                  "cursor-pointer",
                  isSelected
                    ? "border-gold bg-gold-muted text-gold-dark"
                    : "border-border-base bg-white text-text-secondary hover:border-border-hover",
                )}
              >
                {v}
              </button>
            );
          })}
        </div>
      </div>

      {/* Activity Types */}
      <div>
        <p className="font-sans text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-2">
          Deal & Event Types
        </p>
        <div className="flex flex-wrap gap-2">
          {ACTIVITY_TYPES.map((a) => {
            const isSelected = selectedActivityTypes.includes(a);
            return (
              <button
                key={a}
                type="button"
                onClick={() => onActivityTypeToggle(a)}
                className={cn(
                  "px-3.5 py-2 rounded-lg border",
                  "font-sans text-[12px] font-medium",
                  "transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
                  "cursor-pointer",
                  isSelected
                    ? "border-gold bg-gold-muted text-gold-dark"
                    : "border-border-base bg-white text-text-secondary hover:border-border-hover",
                )}
              >
                {a}
              </button>
            );
          })}
        </div>
      </div>

      {(selectedVerticals.length > 0 || selectedActivityTypes.length > 0) && (
        <p className="font-sans text-[11px] text-text-muted">
          {selectedVerticals.length} vertical{selectedVerticals.length !== 1 ? "s" : ""}
          {selectedVerticals.length > 0 && selectedActivityTypes.length > 0 && ", "}
          {selectedActivityTypes.length > 0 && `${selectedActivityTypes.length} deal type${selectedActivityTypes.length !== 1 ? "s" : ""}`}
          {" "}selected
        </p>
      )}
    </div>
  );
}

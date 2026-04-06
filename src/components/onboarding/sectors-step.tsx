"use client";

import { cn } from "@/lib/utils";

const sectors = [
  "Technology M&A",
  "Venture Capital",
  "Private Equity",
  "Public Markets",
  "Geopolitics & Macro",
  "Real Estate & REITs",
  "Fintech & Crypto",
  "Healthcare & Biotech",
  "Energy & Climate",
  "Consumer & Retail",
  "Industrials",
  "Financial Services",
];

interface SectorsStepProps {
  selected: string[];
  onToggle: (sector: string) => void;
}

export function SectorsStep({ selected, onToggle }: SectorsStepProps) {
  return (
    <div>
      <h2 className="font-display text-[22px] font-extrabold text-espresso mb-1">
        Pick your sectors
      </h2>
      <p className="font-sans text-[13px] text-text-secondary mb-5">
        Select sectors you want to track. You can change these anytime.
      </p>

      <div className="flex flex-wrap gap-2">
        {sectors.map((sector) => {
          const isSelected = selected.includes(sector);
          return (
            <button
              key={sector}
              type="button"
              onClick={() => onToggle(sector)}
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
              {sector}
            </button>
          );
        })}
      </div>

      {selected.length > 0 && (
        <p className="mt-3 font-sans text-[11px] text-text-muted">
          {selected.length} sector{selected.length !== 1 ? "s" : ""} selected
        </p>
      )}
    </div>
  );
}

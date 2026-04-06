"use client";

import { cn } from "@/lib/utils";
import { useState } from "react";
import Link from "next/link";

interface DailyBriefsWidgetProps {
  morningSignals?: string[];
  eveningSignals?: string[];
}

export function DailyBriefsWidget({
  morningSignals = [
    "Fed pivot expectations rising",
    "NVDA earnings beat estimates",
    "China PMI contracts again",
  ],
  eveningSignals = [
    "Bond yields dropped 8bps",
    "Tech sector led recovery",
    "VIX settled below 15",
  ],
}: DailyBriefsWidgetProps) {
  const [active, setActive] = useState<"morning" | "evening">("morning");
  const signals = active === "morning" ? morningSignals : eveningSignals;

  return (
    <div>
      {/* Toggle buttons */}
      <div className="flex gap-1.5 mb-3">
        <button
          type="button"
          onClick={() => setActive("morning")}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg",
            "font-sans text-[11px] font-semibold transition-all duration-[var(--duration-base)]",
            "cursor-pointer",
            active === "morning"
              ? "bg-espresso text-cream"
              : "bg-parchment text-text-muted hover:bg-parchment-mid",
          )}
        >
          ☀️ Morning
        </button>
        <button
          type="button"
          onClick={() => setActive("evening")}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg",
            "font-sans text-[11px] font-semibold transition-all duration-[var(--duration-base)]",
            "cursor-pointer",
            active === "evening"
              ? "bg-espresso text-cream"
              : "bg-parchment text-text-muted hover:bg-parchment-mid",
          )}
        >
          🌙 Evening
        </button>
      </div>

      {/* Signal pills */}
      <div className="space-y-1.5">
        {signals.map((signal, i) => (
          <div key={i} className="flex items-center gap-2 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-gold flex-shrink-0" />
            <span className="font-sans text-[11px] text-text-secondary leading-snug">
              {signal}
            </span>
          </div>
        ))}
      </div>

      {/* Link */}
      <Link
        href={active === "morning" ? "/morning-brief" : "/evening-wrap"}
        className="block mt-3 font-sans text-[10px] font-semibold text-gold hover:text-gold-dark transition-colors"
      >
        Read full {active === "morning" ? "brief" : "wrap"} →
      </Link>
    </div>
  );
}

"use client";

import { cn } from "@/lib/utils";
import { MoodDebugOverlay } from "./mood-debug-overlay";

export type MoodType = "risk-off" | "risk-on" | "neutral" | "mixed" | "watch";

interface MoodBarProps {
  mood?: MoodType;
  headline?: string;
  details?: string[];
}

const moodConfig: Record<MoodType, { dotColor: string; badgeClass: string; badgeLabel: string }> = {
  "risk-off": {
    dotColor: "bg-signal-dn",
    badgeClass: "bg-signal-dn/20 text-signal-dn dark:bg-[rgba(224,92,92,0.12)] dark:text-negative dark:border dark:border-[rgba(224,92,92,0.3)]",
    badgeLabel: "Risk-Off",
  },
  "risk-on": {
    dotColor: "bg-signal-up",
    badgeClass: "bg-signal-up/20 text-signal-up dark:bg-[rgba(76,175,125,0.12)] dark:text-positive dark:border dark:border-[rgba(76,175,125,0.3)]",
    badgeLabel: "Risk-On",
  },
  neutral: {
    dotColor: "bg-signal-warn",
    badgeClass: "bg-signal-warn/20 text-signal-warn",
    badgeLabel: "Neutral",
  },
  mixed: {
    dotColor: "bg-gold",
    badgeClass: "bg-gold-muted text-gold-dark border border-gold-border dark:bg-[rgba(212,168,75,0.15)] dark:text-gold dark:border-[rgba(212,168,75,0.35)]",
    badgeLabel: "Mixed",
  },
  watch: {
    dotColor: "bg-text-muted",
    badgeClass: "bg-parchment-mid text-text-secondary border border-border-base dark:bg-[rgba(100,116,139,0.18)] dark:text-text-secondary dark:border-[rgba(100,116,139,0.35)]",
    badgeLabel: "Watch",
  },
};

export function MoodBar({
  mood = "neutral",
  headline = "Markets steady",
  details = ["VIX 14.2", "S&P flat"],
}: MoodBarProps) {
  const config = moodConfig[mood];

  return (
    <div className="h-[var(--moodbar-height)] bg-espresso dark:bg-sidebar-bg dark:border-b dark:border-border-subtle flex items-center px-4 gap-3">
      {/* Dot */}
      <span className={cn("w-2 h-2 rounded-full flex-shrink-0", config.dotColor)} />

      {/* Mood text */}
      <p className="flex-1 font-sans text-[11px] text-gold-light dark:text-text-secondary truncate">
        <span className="font-semibold text-cream dark:text-foreground">{headline}</span>
        {details.map((d, i) => (
          <span key={i}> · {d}</span>
        ))}
      </p>

      {/* Badge */}
      <span
        className={cn(
          "flex-shrink-0 px-2.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wide",
          config.badgeClass,
        )}
      >
        {config.badgeLabel}
      </span>

      {/* Dev-only inspector — hidden unless ?debug=mood is in the URL. */}
      <MoodDebugOverlay />
    </div>
  );
}

"use client";

import { cn } from "@/lib/utils";

export type MoodType = "risk-off" | "risk-on" | "neutral";

interface MoodBarProps {
  mood?: MoodType;
  headline?: string;
  details?: string[];
}

const moodConfig: Record<MoodType, { dotColor: string; badgeClass: string; badgeLabel: string }> = {
  "risk-off": {
    dotColor: "bg-signal-dn",
    badgeClass: "bg-signal-dn/20 text-signal-dn",
    badgeLabel: "Risk-Off",
  },
  "risk-on": {
    dotColor: "bg-signal-up",
    badgeClass: "bg-signal-up/20 text-signal-up",
    badgeLabel: "Risk-On",
  },
  neutral: {
    dotColor: "bg-signal-warn",
    badgeClass: "bg-signal-warn/20 text-signal-warn",
    badgeLabel: "Neutral",
  },
};

export function MoodBar({
  mood = "neutral",
  headline = "Markets steady",
  details = ["VIX 14.2", "S&P flat"],
}: MoodBarProps) {
  const config = moodConfig[mood];

  return (
    <div className="h-[var(--moodbar-height)] bg-espresso flex items-center px-4 gap-3">
      {/* Dot */}
      <span className={cn("w-2 h-2 rounded-full flex-shrink-0", config.dotColor)} />

      {/* Mood text */}
      <p className="flex-1 font-sans text-[11px] text-gold-light truncate">
        <span className="font-semibold text-cream">{headline}</span>
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
    </div>
  );
}

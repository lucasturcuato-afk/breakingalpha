"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

interface GreetingProps {
  storyCount?: number;
  context?: string;
}

function getTimeOfDay(): string {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

export function getMarketStatus(): string {
  const now = new Date();
  const day = now.getDay();
  const h = now.getHours();
  const m = now.getMinutes();
  const mins = h * 60 + m;
  const MARKET_OPEN_MIN = 570;   // 9:30 AM EST
  const MARKET_CLOSE_MIN = 960;  // 4:00 PM EST
  if (day === 0 || day === 6) return "Markets Closed";
  if (mins >= MARKET_OPEN_MIN && mins < MARKET_CLOSE_MIN) return "Markets Open";
  return "Markets Closed";
}

/** Compact date for the header pill, e.g. "Sat, Jul 12". */
export function formatShortDate(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * `context` is optional and has NO default. It carries a claim about the tape
 * or the user's feed, so it is rendered only when a caller derived one from
 * real data. A hardcoded fallback here reads as a measured observation and is
 * not one.
 */
export function Greeting({ storyCount = 0, context }: GreetingProps) {
  const [mounted, setMounted] = useState(false);
  const [userName, setUserName] = useState("there");

  useEffect(() => {
    setMounted(true);

    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        const name =
          user.user_metadata?.full_name?.split(" ")[0] ||
          user.user_metadata?.name?.split(" ")[0] ||
          user.email?.split("@")[0] ||
          "there";
        setUserName(name);
      }
    });
  }, []);

  // Prevent hydration mismatch — render placeholder until client
  if (!mounted) {
    return (
      <div className="space-y-1">
        <div className="h-3 w-48 bg-border-subtle rounded animate-pulse" />
        <div className="h-8 w-72 bg-border-subtle rounded animate-pulse" />
        <div className="h-4 w-64 bg-border-subtle rounded animate-pulse" />
      </div>
    );
  }

  const timeOfDay = getTimeOfDay();

  return (
    <div className="max-w-[640px]">
      <p className="font-display italic text-[16px] text-gold-dark m-0 mb-2">
        Your {timeOfDay} briefing
      </p>
      <h2 className="font-display text-[32px] md:text-[42px] font-medium text-espresso m-0 leading-[1] tracking-[-0.025em]">
        Good {timeOfDay}, {userName}.
      </h2>
      <p className="font-display italic text-[15px] md:text-[17px] text-text-secondary mt-2.5 leading-[1.5]">
        {storyCount > 0
          ? `${storyCount} high-signal stories worth your attention${context ? ` — ${context}` : "."}`
          : `No new stories yet${context ? ` — ${context}` : "."}`}
      </p>
    </div>
  );
}

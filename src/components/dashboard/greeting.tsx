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

function getMarketStatus(): string {
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

function formatDate(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function Greeting({
  storyCount = 0,
  context = "markets are adjusting to new data.",
}: GreetingProps) {
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
  const marketStatus = getMarketStatus();
  const dateStr = formatDate();

  return (
    <div>
      <p className="font-sans text-[11px] uppercase tracking-widest text-gold font-medium">
        {dateStr} · {marketStatus}
      </p>
      <h2 className="font-display text-[28px] font-extrabold text-espresso mt-1 leading-tight">
        Good {timeOfDay}, {userName}.
      </h2>
      <p className="font-sans text-[13px] text-text-secondary mt-1">
        {storyCount > 0
          ? `${storyCount} high-signal stories in your feed — ${context}`
          : `No new stories yet — ${context}`}
      </p>
    </div>
  );
}

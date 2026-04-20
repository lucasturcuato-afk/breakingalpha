"use client";

import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";
import { useUserProfile } from "@/hooks/useUserProfile";
import { sectorMatchesProfile } from "@/lib/personalization";

interface AISignalBarProps {
  text: string;
  boldParts?: string[];
  ctaHref?: string;
  signalSectors?: string[];
}

export function AISignalBar({
  text = "Fed language shift detected across 3 FOMC transcripts — dovish pivot probability rising. Bond markets already pricing in.",
  boldParts = ["Fed language shift", "dovish pivot probability rising"],
  ctaHref,
  signalSectors,
}: AISignalBarProps) {
  const { profile } = useUserProfile();
  const watchlist = (profile?.watchlist_tickers ?? []).map((t) => t.toUpperCase());

  // Bold specific parts + highlight watchlist tickers in gold
  let rendered = text;
  for (const part of boldParts) {
    rendered = rendered.replace(
      part,
      `<strong class="text-cream dark:text-foreground font-semibold">${part}</strong>`,
    );
  }
  // Highlight watchlist tickers mentioned in the signal text
  for (const ticker of watchlist) {
    const regex = new RegExp(`\\b${ticker}\\b`, "g");
    rendered = rendered.replace(
      regex,
      `<span class="text-gold font-bold">${ticker}</span>`,
    );
  }

  // Check if signal matches user's focus areas
  const matchesFocus = signalSectors?.some((s) => sectorMatchesProfile(s, profile)) ?? false;

  const hour = new Date().getHours();
  const briefLink = ctaHref || (hour >= 17 ? "/evening-wrap" : "/morning-brief");
  const ctaLabel = hour >= 17 ? "Get evening wrap ↗" : "Get full AI briefing ↗";

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-3",
        "bg-espresso dark:bg-overlay dark:border dark:border-border-default rounded-xl",
      )}
    >
      {/* Icon */}
      <div className="w-8 h-8 rounded-lg bg-gold-muted border border-gold-border flex items-center justify-center flex-shrink-0">
        <Sparkles size={13} className="text-gold" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="font-sans text-[9px] uppercase tracking-widest text-gold font-semibold mb-0.5">
          Signalera AI · Live Signal
          {matchesFocus && (
            <span className="ml-2 text-cream/60 normal-case tracking-normal">
              · Matches your focus
            </span>
          )}
        </p>
        <p
          className="font-sans text-[12px] text-gold-light leading-relaxed truncate"
          dangerouslySetInnerHTML={{ __html: rendered }}
        />
      </div>

      {/* CTA */}
      <a
        href={briefLink}
        className="flex-shrink-0 font-sans text-[11px] font-bold text-gold hover:text-gold-light transition-colors whitespace-nowrap"
      >
        {ctaLabel}
      </a>
    </div>
  );
}

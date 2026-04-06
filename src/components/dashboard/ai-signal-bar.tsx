"use client";

import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";

interface AISignalBarProps {
  text: string;
  boldParts?: string[];
  ctaHref?: string;
}

export function AISignalBar({
  text = "Fed language shift detected across 3 FOMC transcripts — dovish pivot probability rising. Bond markets already pricing in.",
  boldParts = ["Fed language shift", "dovish pivot probability rising"],
  ctaHref,
}: AISignalBarProps) {
  // Bold specific parts of the text
  let rendered = text;
  for (const part of boldParts) {
    rendered = rendered.replace(
      part,
      `<strong class="text-cream font-semibold">${part}</strong>`,
    );
  }

  const hour = new Date().getHours();
  const briefLink = ctaHref || (hour >= 17 ? "/evening-wrap" : "/morning-brief");
  const ctaLabel = hour >= 17 ? "Get evening wrap ↗" : "Get full AI briefing ↗";

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-3",
        "bg-espresso rounded-xl",
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

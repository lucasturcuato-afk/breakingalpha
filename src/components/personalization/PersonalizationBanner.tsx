"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowRight, X, Sparkles } from "lucide-react";
import { useUserProfile } from "@/hooks/useUserProfile";
import { Badge } from "@/components/ui/badge";

const DISMISS_KEY = "personalization-banner-dismissed";

function getCompletionPct(profile: {
  role?: string | null;
  sectors?: string[] | null;
  strategy_type?: string | null;
  investment_horizon?: string | null;
}): number {
  let filled = 0;
  if (profile.role) filled++;
  if (profile.sectors && profile.sectors.length > 0) filled++;
  if (profile.strategy_type) filled++;
  if (profile.investment_horizon) filled++;
  return Math.round((filled / 4) * 100);
}

function isProfileIncomplete(profile: {
  role?: string | null;
  sectors?: string[] | null;
  strategy_type?: string | null;
  investment_horizon?: string | null;
}): boolean {
  return (
    !profile.role ||
    !profile.sectors ||
    profile.sectors.length === 0 ||
    !profile.strategy_type ||
    !profile.investment_horizon
  );
}

export function PersonalizationBanner() {
  const { profile } = useUserProfile();
  const [dismissed, setDismissed] = useState(true); // start hidden to avoid flash

  useEffect(() => {
    // Check sessionStorage (re-show each session)
    const stored = sessionStorage.getItem(DISMISS_KEY);
    setDismissed(stored === "true");
  }, []);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    sessionStorage.setItem(DISMISS_KEY, "true");
  }, []);

  if (dismissed || !profile) return null;

  const incomplete = isProfileIncomplete(profile);

  if (incomplete) {
    const pct = getCompletionPct(profile);
    return (
      <div data-tour="personalization-banner" className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border border-gold-border bg-gold-muted/30 mb-4">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="h-3.5 w-3.5 text-gold-dark shrink-0" />
          <span className="text-xs text-text-secondary truncate">
            Your profile is {pct}% complete.{" "}
            <Link
              href="/settings/profile?from=brief-nudge"
              className="text-gold-dark font-medium hover:underline"
            >
              Complete it for better personalization
              <ArrowRight className="inline h-3 w-3 ml-0.5" />
            </Link>
          </span>
        </div>
        <button
          onClick={handleDismiss}
          className="shrink-0 p-0.5 rounded hover:bg-parchment-mid transition-colors"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5 text-text-muted" />
        </button>
      </div>
    );
  }

  // Full banner — show personalization chips
  const chips: string[] = [];
  if (profile.sectors && profile.sectors.length > 0) {
    chips.push(...profile.sectors.slice(0, 3));
  }
  if (profile.risk_appetite) {
    chips.push(profile.risk_appetite);
  }

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border border-border-subtle bg-parchment-mid/40 mb-4">
      <div className="flex items-center gap-2 min-w-0 flex-wrap">
        <span className="text-xs text-text-muted whitespace-nowrap">
          Personalized for:
        </span>
        {chips.map((chip) => (
          <Badge key={chip} variant="default" className="text-[8px]">
            {chip}
          </Badge>
        ))}
        <Link
          href="/settings/profile"
          className="text-xs text-text-secondary hover:text-text-primary font-medium whitespace-nowrap"
        >
          Edit <ArrowRight className="inline h-3 w-3" />
        </Link>
      </div>
      <button
        onClick={handleDismiss}
        className="shrink-0 p-0.5 rounded hover:bg-parchment-mid transition-colors"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5 text-text-muted" />
      </button>
    </div>
  );
}

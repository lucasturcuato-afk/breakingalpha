"use client";

import { useState, useEffect } from "react";
import { Star, X } from "lucide-react";
import { cn } from "@/lib/utils";

const DISMISSED_KEY = "signalera_onboarding_dismissed";

export function PersonalizationBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const dismissed = localStorage.getItem(DISMISSED_KEY);
    if (!dismissed) setVisible(true);
  }, []);

  if (!visible) return null;

  function dismiss() {
    if (typeof window !== "undefined") localStorage.setItem(DISMISSED_KEY, "true");
    setVisible(false);
  }

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-3",
        "bg-gold-muted border border-gold-border rounded-xl",
      )}
    >
      <div className="w-8 h-8 rounded-lg bg-gold-muted border border-gold-border flex items-center justify-center flex-shrink-0">
        <Star size={14} className="text-gold" />
      </div>
      <p className="flex-1 font-sans text-[12px] text-text-secondary">
        <span className="font-semibold text-text-primary">Personalize your feed.</span>{" "}
        Select sectors and topics you care about to get better signals.
      </p>
      <a
        href="/settings"
        className="flex-shrink-0 font-sans text-[11px] font-bold text-gold hover:text-gold-dark transition-colors"
      >
        Set interests →
      </a>
      <button
        type="button"
        onClick={dismiss}
        className="flex-shrink-0 p-1 rounded-md hover:bg-gold-border transition-colors cursor-pointer"
        aria-label="Dismiss"
      >
        <X size={12} className="text-text-faint" />
      </button>
    </div>
  );
}

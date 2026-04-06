"use client";

import { useState, useEffect } from "react";

export function OnboardingBanner() {
  const [mounted, setMounted] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onboarded = localStorage.getItem("signalera_onboarded");
    setShow(!onboarded);
    setMounted(true);
  }, []);

  if (!mounted) return null;
  if (!show) return null;

  return (
    <div className="mb-3 flex items-center gap-3 bg-gold/10 border border-gold/30 rounded-xl px-4 py-3">
      <span className="font-sans text-[12px] text-espresso">
        Welcome to Signalera. Complete your profile to get personalized signals.
      </span>
      <a
        href="/settings"
        className="font-sans text-[11px] font-semibold text-gold hover:underline ml-auto flex-shrink-0"
      >
        Set up profile &rarr;
      </a>
      <button
        type="button"
        onClick={() => {
          localStorage.setItem("signalera_onboarded", "true");
          setShow(false);
        }}
        className="text-text-muted hover:text-text-primary text-sm ml-1 cursor-pointer"
      >
        &times;
      </button>
    </div>
  );
}

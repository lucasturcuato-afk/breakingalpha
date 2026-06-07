"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { driver, type DriveStep, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import "./tour-styles.css";
import { useUserProfile } from "@/hooks/useUserProfile";
import { usePathname, useRouter } from "next/navigation";
import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Tour step definitions ───────────────────────────────────────────────────

const TOUR_STEPS: DriveStep[] = [
  {
    popover: {
      title: "Welcome to Signalera",
      description:
        "Here's a 60-second tour of your intelligence platform. We'll walk through the key features so you know exactly where everything lives.",
      side: "over",
      align: "center",
    },
  },
  {
    element: "[data-tour='ai-signal-bar']",
    popover: {
      title: "AI Signal Bar",
      description:
        "Your real-time market intelligence headline — generated from overnight analysis of deals, sentiment, and macro data.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: "[data-tour='morning-brief-link']",
    popover: {
      title: "Morning Brief",
      description:
        "Start your day here — a personalized brief with market pulse, top stories, analyst sections, and deal flow. Generated fresh each morning.",
      side: "right",
      align: "start",
    },
  },
  {
    element: "[data-tour='morning-brief-link']",
    popover: {
      title: "Top Stories",
      description:
        "Inside the brief, stories are ranked by relevance to your watchlist and sectors. The 'For You' tab surfaces what matters most.",
      side: "right",
      align: "start",
    },
  },
  {
    element: "[data-tour='personalization-banner']",
    popover: {
      title: "Personalization",
      description:
        "Your content is shaped by your profile — role, sectors, watchlist, and risk appetite. Complete your profile for better signal quality.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: "[data-tour='evening-wrap-link']",
    popover: {
      title: "Evening Wrap",
      description:
        "End-of-day recap with market scorecard, morning prediction review, and tomorrow's setup.",
      side: "right",
      align: "start",
    },
  },
  {
    element: "[data-tour='company-link']",
    popover: {
      title: "Company Intel",
      description:
        "Deep-dive on any company — news mentions, key themes, AI-generated research memos, and recent filings.",
      side: "right",
      align: "start",
    },
  },
  {
    element: "[data-tour='intelligence-link']",
    popover: {
      title: "Intelligence Chat",
      description:
        "Ask anything about markets, companies, or your portfolio. AI-powered research assistant with full context.",
      side: "right",
      align: "start",
    },
  },
  {
    element: "[data-tour='thesis-board-link']",
    popover: {
      title: "Thesis Board",
      description:
        "Track your investment theses and let Signalera grade them over time as new evidence arrives.",
      side: "right",
      align: "start",
    },
  },
  {
    element: "[data-tour='track-record-link']",
    popover: {
      title: "Track Record",
      description:
        "See how your theses and signals have played out — conviction scoring and historical performance.",
      side: "right",
      align: "start",
    },
  },
  {
    element: "[data-tour='settings-link'], [data-tour='settings-link-desktop']",
    popover: {
      title: "Profile & Preferences",
      description:
        "Tell Signalera about your role, sectors, and risk appetite. Better profile = better personalization across every surface.",
      side: "top",
      align: "start",
    },
  },
  {
    popover: {
      title: "You're all set!",
      description:
        "That's the tour. Use the ? button in the bottom-right corner anytime to replay it. Welcome to Signalera.",
      side: "over",
      align: "center",
    },
  },
];

// ─── Tour logic ──────────────────────────────────────────────────────────────

const LOCAL_STORAGE_KEY = "signalera_tour_completed";

function useTourDriver(onComplete: () => void) {
  const driverRef = useRef<Driver | null>(null);

  const start = useCallback(() => {
    if (driverRef.current) {
      driverRef.current.destroy();
    }

    const d = driver({
      showProgress: true,
      steps: TOUR_STEPS,
      nextBtnText: "Next",
      prevBtnText: "Back",
      doneBtnText: "Done",
      popoverClass: "signalera-tour-popover",
      stagePadding: 6,
      stageRadius: 8,
      onDestroyStarted: () => {
        // If user is on last step, treat as completed
        if (d.isLastStep()) {
          onComplete();
        }
        d.destroy();
      },
      onDestroyed: () => {
        driverRef.current = null;
      },
    });

    driverRef.current = d;
    d.drive();
  }, [onComplete]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      driverRef.current?.destroy();
    };
  }, []);

  return { start };
}

// ─── SignaleraTour (auto-trigger) ────────────────────────────────────────────

export function SignaleraTour() {
  const { profile, loading, updateProfile } = useUserProfile();
  const pathname = usePathname();
  const [triggered, setTriggered] = useState(false);

  const handleComplete = useCallback(() => {
    // Mark in localStorage immediately
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, "true");
    } catch {}

    // Persist to DB
    updateProfile({
      tour_completed: true,
      tour_completed_at: new Date().toISOString(),
    } as Record<string, unknown>);
  }, [updateProfile]);

  const { start } = useTourDriver(handleComplete);

  useEffect(() => {
    if (loading || triggered) return;
    if (!profile) return;

    // Don't auto-fire if onboarding isn't completed
    if (!profile.onboarding_completed) return;

    // Don't auto-fire if tour already completed (DB or localStorage)
    if ((profile as Record<string, unknown>).tour_completed) return;
    try {
      if (localStorage.getItem(LOCAL_STORAGE_KEY) === "true") return;
    } catch {}

    // Only auto-fire on dashboard
    if (pathname !== "/dashboard") return;

    // Small delay to let the page render
    const timer = setTimeout(() => {
      setTriggered(true);
      start();
    }, 800);

    return () => clearTimeout(timer);
  }, [loading, profile, pathname, triggered, start]);

  return null;
}

// ─── TourHelpButton (manual trigger) ─────────────────────────────────────────

export function TourHelpButton() {
  const { profile, loading } = useUserProfile();
  const pathname = usePathname();

  const handleComplete = useCallback(() => {
    // Manual restart — do NOT update tour_completed
  }, []);

  const { start } = useTourDriver(handleComplete);

  // Don't show on public pages
  if (loading || !profile) return null;
  if (pathname === "/" || pathname === "/auth" || pathname?.startsWith("/auth/")) return null;

  return (
    <button
      type="button"
      onClick={start}
      className={cn(
        "fixed bottom-5 right-5 z-[8000]",
        "w-10 h-10 rounded-full",
        "bg-espresso text-cream dark:bg-elevated dark:text-foreground",
        "border border-border-base shadow-lg",
        "flex items-center justify-center",
        "hover:bg-gold hover:text-cream hover:border-gold",
        "transition-all duration-200 cursor-pointer",
        "group",
      )}
      aria-label="Restart product tour"
      title="Restart tour"
    >
      <HelpCircle size={18} className="group-hover:scale-110 transition-transform" />
    </button>
  );
}
